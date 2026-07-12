import { type CoreSettingsItem, type CoreSettingsSnapshot, createCoreSettingsService } from "@cline/core"
import { parseRemoteSkillEntries } from "@core/context/instructions/user-instructions/skills"
import { EmptyRequest } from "@shared/proto/cline/common"
import { SlashCommandInfo, SlashCommandsResponse } from "@shared/proto/cline/slash"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
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

	// Add enabled skills so they surface in the slash-command autocomplete.
	// Skills share the same custom section and CLI compatibility as workflows.
	for (const skill of await listEnabledSkills(controller)) {
		commands.push(
			SlashCommandInfo.create({
				name: skill.name,
				description: skill.description || `Skill: ${skill.name}`,
				section: "custom",
				cliCompatible: true,
			}),
		)
	}

	return SlashCommandsResponse.create({ commands })
}

function fullPathToFileName(path: string): string {
	// e.g. replace /path/to/workflow.md with workflow.md
	return path.replace(/^.*[/\\]/, "")
}

export function filterEnabledSkillItems(input: {
	skills: CoreSettingsItem[]
	remoteConfigSkills: ReturnType<typeof parseRemoteSkillEntries>
	remoteSkillsToggles: Record<string, boolean>
}): CoreSettingsItem[] {
	const enabled: CoreSettingsItem[] = []
	const seenNames = new Set<string>()

	for (const skill of input.skills) {
		if (skill.enabled === false) {
			continue
		}
		if (seenNames.has(skill.name)) {
			continue
		}
		seenNames.add(skill.name)
		enabled.push(skill)
	}

	for (const remoteSkill of input.remoteConfigSkills) {
		if (!remoteSkill.alwaysEnabled && input.remoteSkillsToggles[remoteSkill.name] === false) {
			continue
		}
		if (seenNames.has(remoteSkill.name)) {
			continue
		}
		seenNames.add(remoteSkill.name)
		enabled.push({
			id: `remote:${remoteSkill.name}`,
			name: remoteSkill.name,
			description: remoteSkill.description,
			path: `remote:${remoteSkill.name}`,
			kind: "skill",
			source: "global",
			enabled: true,
		})
	}

	return enabled
}

async function listEnabledSkills(controller: Controller): Promise<CoreSettingsItem[]> {
	try {
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const primaryWorkspace = workspacePaths.paths[0]
		const settingsSnapshot: CoreSettingsSnapshot = await createCoreSettingsService().list({
			workspaceRoot: primaryWorkspace,
		})
		const remoteConfigSettings = controller.stateManager.getRemoteConfigSettings()
		const remoteSkillsToggles = controller.stateManager.getGlobalStateKey("remoteSkillsToggles") || {}

		return filterEnabledSkillItems({
			skills: settingsSnapshot.skills,
			remoteConfigSkills: parseRemoteSkillEntries(remoteConfigSettings.remoteGlobalSkills || []),
			remoteSkillsToggles,
		})
	} catch (error) {
		Logger.warn("getAvailableSlashCommands: failed to list skills for autocomplete", error)
		return []
	}
}
