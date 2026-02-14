import { discoverSkills, getAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import { EmptyRequest } from "@shared/proto/cline/common"
import { SlashCommandInfo, SlashCommandsResponse } from "@shared/proto/cline/slash"
import { toWorkflowCommandName } from "@shared/slash-command-names"
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
	const globalSkillsToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
	const localSkillsToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}

	// Add enabled skills first so skills can win workflow name collisions.
	const skillNames = new Set<string>()
	try {
		const cwd = controller.getWorkspaceManager?.()?.getPrimaryRoot?.()?.path ?? process.cwd()
		const resolvedSkills = getAvailableSkills(await discoverSkills(cwd))
		for (const skill of resolvedSkills) {
			const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
			if (toggles[skill.path] === false) {
				continue
			}

			if (!skillNames.has(skill.name)) {
				skillNames.add(skill.name)

				commands.push(
					SlashCommandInfo.create({
						name: skill.name,
						description: skill.description,
						section: "skill",
						cliCompatible: true,
					}),
				)
			}
		}
	} catch {
		// Skills are additive for slash autocomplete. If discovery fails, continue.
	}

	// Track workflow names to avoid duplicates from global/remote
	const workflowNames = new Set<string>()

	// Add local workflows (enabled only)
	for (const [path, enabled] of Object.entries(localWorkflowToggles)) {
		if (enabled) {
			const fileName = toWorkflowCommandName(path)
			if (skillNames.has(fileName) || workflowNames.has(fileName)) {
				continue
			}
			workflowNames.add(fileName)
			commands.push(
				SlashCommandInfo.create({
					name: fileName,
					description: "Workflow command",
					section: "custom",
					cliCompatible: true,
				}),
			)
		}
	}

	// Add global workflows (enabled only, skip if local exists with same name)
	for (const [path, enabled] of Object.entries(globalWorkflowToggles)) {
		if (enabled) {
			const fileName = toWorkflowCommandName(path)
			if (skillNames.has(fileName) || workflowNames.has(fileName)) {
				continue
			}
			workflowNames.add(fileName)
			commands.push(
				SlashCommandInfo.create({
					name: fileName,
					description: "Workflow command",
					section: "custom",
					cliCompatible: true,
				}),
			)
		}
	}

	// Add remote workflows that are enabled
	for (const workflow of remoteWorkflows) {
		const enabled = workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] !== false
		if (enabled) {
			const workflowName = toWorkflowCommandName(workflow.name)
			if (skillNames.has(workflowName) || workflowNames.has(workflowName)) {
				continue
			}
			workflowNames.add(workflowName)
			commands.push(
				SlashCommandInfo.create({
					name: workflowName,
					description: "Workflow command",
					section: "custom",
					cliCompatible: true,
				}),
			)
		}
	}

	return SlashCommandsResponse.create({ commands })
}
