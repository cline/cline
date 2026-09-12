import {
	buildSlashCommandCatalog,
	createSlashCommandTokenRegex,
	detectSlashQuery,
	matchSlashCommands,
	SLASH_COMMAND_TOKEN_CHARS,
	validateSlashCommandInput,
} from "@cline/shared"
import type { McpServer } from "@shared/mcp"
import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { BASE_SLASH_COMMANDS, type SlashCommand, VSCODE_ONLY_COMMANDS } from "../../../src/shared/slashCommands.ts"

export type { SlashCommand }

const DEFAULT_SLASH_COMMANDS: SlashCommand[] =
	PLATFORM_CONFIG.type === PlatformType.VSCODE ? [...BASE_SLASH_COMMANDS, ...VSCODE_ONLY_COMMANDS] : BASE_SLASH_COMMANDS

/**
 * Skills and workflows served by the extension host (`getAvailableSlashCommands`),
 * converted to menu entries. The host already spelled each token the way the
 * send path resolves it and applied the user's toggles, so nothing is renamed
 * or filtered here. Built-ins in the host list are ignored: the webview owns
 * its own (platform-specific) built-in list.
 */
export function getRuntimeSlashCommands(runtimeCommands: readonly SlashCommandInfo[] = []): SlashCommand[] {
	const commands: SlashCommand[] = []
	for (const command of runtimeCommands) {
		if (command.kind !== "skill" && command.kind !== "workflow") {
			continue
		}
		commands.push({
			name: command.name,
			description: command.description || undefined,
			section: command.kind === "skill" ? "skill" : "custom",
			kind: command.kind,
			cliCompatible: command.cliCompatible,
		})
	}
	return commands
}

/**
 * Gets MCP prompt commands from connected MCP servers
 * Format: mcp:<server-name>:<prompt-name>
 */
export function getMcpPromptCommands(mcpServers: McpServer[] = []): SlashCommand[] {
	const commands: SlashCommand[] = []

	for (const server of mcpServers) {
		if (server.status !== "connected" || !server.prompts) {
			continue
		}

		for (const prompt of server.prompts) {
			commands.push({
				name: `mcp:${server.name}:${prompt.name}`,
				description: prompt.description || prompt.title || `MCP prompt from ${server.name}`,
				section: "mcp",
				kind: "mcp-prompt",
			})
		}
	}

	return commands
}

/**
 * Every command the menu can offer, in display order: built-ins, skills,
 * workflows, then MCP prompts. Earlier groups win name collisions, so a user
 * command can never shadow a built-in and a skill always beats a same-named
 * MCP prompt (core already resolves skill/workflow collisions host-side).
 */
export function getAllSlashCommands(
	runtimeCommands: readonly SlashCommandInfo[] = [],
	mcpServers: McpServer[] = [],
): SlashCommand[] {
	const runtime = getRuntimeSlashCommands(runtimeCommands)
	return buildSlashCommandCatalog([
		DEFAULT_SLASH_COMMANDS,
		runtime.filter((command) => command.section === "skill"),
		runtime.filter((command) => command.section === "custom"),
		getMcpPromptCommands(mcpServers),
	])
}

// Regex for detecting slash commands in text, shared with the extension host's
// expansion via @cline/shared so anything highlighted here is expandable there.
// Must be at start of string OR preceded by whitespace to avoid matching URLs/paths
// e.g., matches "/newtask" or "text /newtask" but not "http://example.com/newtask"
// Note: Colons are allowed to support MCP prompt commands like /mcp:server:prompt
export const slashCommandRegex = createSlashCommandTokenRegex()
export const slashCommandRegexGlobal = createSlashCommandTokenRegex("g")
// Regex for detecting a slash command at the end of text (for deletion)
// Must be at start OR preceded by whitespace, captures the whole command including slash
export const slashCommandDeleteRegex = new RegExp(String.raw`(^|\s)(\/${SLASH_COMMAND_TOKEN_CHARS}+)$`, "u")

/**
 * Removes a slash command at the cursor position
 */
export function removeSlashCommand(text: string, position: number): { newText: string; newPosition: number } {
	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Check if we're at the end of a slash command (anywhere in text, not just at start)
	const matchEnd = beforeCursor.match(slashCommandDeleteRegex)

	if (matchEnd) {
		// matchEnd[1] is the whitespace or empty string before the slash
		// matchEnd[2] is the slash command (e.g., "/newtask")
		const slashCommand = matchEnd[2]
		const newText = text.slice(0, position - slashCommand.length) + afterCursor.replace(" ", "") // removes the first space after the command
		const newPosition = position - slashCommand.length
		return { newText, newPosition }
	}

	// If we're not at the end of a slash command, just return the original text and position
	return { newText: text, newPosition: position }
}

/**
 * Determines whether the slash command menu should be displayed based on text input.
 * Only shows for the FIRST valid slash command position in the message - subsequent
 * slash commands won't trigger suggestions since only one is processed per message.
 */
export function shouldShowSlashCommandsMenu(text: string, cursorPosition: number): boolean {
	return detectSlashQuery(text, cursorPosition) !== null
}

/** The prefix typed after the slash the menu is open for (empty when the menu should be closed). */
export function getSlashCommandsQuery(text: string, cursorPosition: number): string {
	return detectSlashQuery(text, cursorPosition)?.query ?? ""
}

/**
 * Gets filtered slash commands that match the current input
 */
export function getMatchingSlashCommands(
	query: string,
	runtimeCommands: readonly SlashCommandInfo[] = [],
	mcpServers: McpServer[] = [],
): SlashCommand[] {
	return matchSlashCommands(getAllSlashCommands(runtimeCommands, mcpServers), query)
}

/**
 * Insert a slash command at position or replace partial command
 */
export function insertSlashCommand(
	text: string,
	commandName: string,
	partialCommandLength: number,
	cursorPosition: number,
): { newValue: string; commandIndex: number } {
	// Find the slash nearest to cursor (before cursor position)
	const beforeCursor = text.slice(0, cursorPosition)
	const slashIndex = beforeCursor.lastIndexOf("/")

	const beforeSlash = text.substring(0, slashIndex + 1)
	const afterPartialCommand = text.substring(slashIndex + 1 + partialCommandLength)

	// replace the partial command with the full command
	const newValue =
		beforeSlash + commandName + (afterPartialCommand.startsWith(" ") ? afterPartialCommand : " " + afterPartialCommand)

	return { newValue, commandIndex: slashIndex }
}

/**
 * Determines the validation state of a slash command
 * Returns partial if we have a partial match against valid commands, or full for full match
 */
export function validateSlashCommand(
	command: string,
	runtimeCommands: readonly SlashCommandInfo[] = [],
	mcpServers: McpServer[] = [],
): "full" | "partial" | null {
	return validateSlashCommandInput(getAllSlashCommands(runtimeCommands, mcpServers), command)
}
