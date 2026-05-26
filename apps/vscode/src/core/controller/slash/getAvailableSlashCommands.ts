import { EmptyRequest } from "@shared/proto/cline/common"
import { SlashCommandInfo, SlashCommandsResponse } from "@shared/proto/cline/slash"
import { BASE_SLASH_COMMANDS } from "@/shared/slashCommands"
import { Controller } from ".."

/**
 * Returns all available slash commands for autocomplete.
 */
export async function getAvailableSlashCommands(controller: Controller, _request: EmptyRequest): Promise<SlashCommandsResponse> {
	const commands: SlashCommandInfo[] = []

	// Add built-in commands
	for (const cmd of [...BASE_SLASH_COMMANDS]) {
		commands.push(
			SlashCommandInfo.create({
				name: cmd.name,
				description: cmd.description,
				section: "default",
				cliCompatible: cmd.cliCompatible,
			}),
		)
	}

	// Get workflow toggles from state
	const localWorkflowToggles = controller.stateManager.getWorkspaceStateKey("workflowToggles") ?? {}
	const globalWorkflowToggles = controller.stateManager.getGlobalSettingsKey("globalWorkflowToggles") ?? {}
	const remoteWorkflowToggles = controller.stateManager.getGlobalStateKey("remoteWorkflowToggles") ?? {}
	const remoteConfigSettings = controller.stateManager.getRemoteConfigSettings()
	const remoteWorkflows = remoteConfigSettings?.remoteGlobalWorkflows ?? []

	// Track local workflow names to avoid duplicates from global
	const localNames = new Set<string>()

	// Add local workflows (enabled only)
	for (const [path, enabled] of Object.entries(localWorkflowToggles)) {
		if (enabled) {
			const fileName = fullPathToFileName(path)
			localNames.add(fileName)
			commands.push(
				SlashCommandInfo.create({
					name: fileName,
					description: `Custom workflow: ${fileName}`,
					section: "custom",
					cliCompatible: true,
				}),
			)
		}
	}

	// Add global workflows (enabled only, skip if local exists with same name)
	for (const [path, enabled] of Object.entries(globalWorkflowToggles)) {
		if (enabled) {
			const fileName = fullPathToFileName(path)
			if (!localNames.has(fileName)) {
				commands.push(
					SlashCommandInfo.create({
						name: fileName,
						description: `Custom workflow: ${fileName}`,
						section: "custom",
						cliCompatible: true,
					}),
				)
			}
		}
	}

	// Add remote workflows that are enabled
	for (const workflow of remoteWorkflows) {
		const enabled = workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] !== false
		if (enabled) {
			commands.push(
				SlashCommandInfo.create({
					name: workflow.name,
					description: `Remote workflow: ${workflow.name}`,
					section: "custom",
					cliCompatible: true,
				}),
			)
		}
	}

	return SlashCommandsResponse.create({ commands })
}

function fullPathToFileName(path: string): string {
	// e.g. replace /path/to/workflow.md with workflow.md
	return path.replace(/^.*[/\\]/, "")
}
