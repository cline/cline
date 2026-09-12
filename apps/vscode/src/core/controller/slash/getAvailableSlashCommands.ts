import { EmptyRequest } from "@shared/proto/cline/common"
import { SlashCommandInfo, SlashCommandsResponse } from "@shared/proto/cline/slash"
import { BASE_SLASH_COMMANDS } from "@/shared/slashCommands"
import { Controller } from ".."

/**
 * Returns all available slash commands for autocomplete: the built-in commands,
 * then every skill and workflow the SDK runtime discovered — spelled exactly as
 * the send path resolves them and already filtered by the user's toggles.
 * Skills are listed before workflows so the menu can group them. MCP prompt
 * commands are added webview-side from the live MCP server list.
 */
export async function getAvailableSlashCommands(controller: Controller, _request: EmptyRequest): Promise<SlashCommandsResponse> {
	const commands: SlashCommandInfo[] = BASE_SLASH_COMMANDS.map((cmd) =>
		SlashCommandInfo.create({
			name: cmd.name,
			description: cmd.description,
			section: "default",
			cliCompatible: cmd.cliCompatible,
			kind: "builtin",
		}),
	)

	const runtimeCommands = await controller.listRuntimeSlashCommands()
	for (const kind of ["skill", "workflow"] as const) {
		for (const command of runtimeCommands) {
			if (command.kind !== kind) {
				continue
			}
			commands.push(
				SlashCommandInfo.create({
					name: command.name,
					description: command.description ?? "",
					section: kind === "skill" ? "skill" : "custom",
					cliCompatible: true,
					kind,
				}),
			)
		}
	}

	return SlashCommandsResponse.create({ commands })
}
