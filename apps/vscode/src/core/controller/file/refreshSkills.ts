import { type CoreSettingsItem, createCoreSettingsService } from "@cline/core"
import { parseRemoteSkillEntries } from "@core/context/instructions/user-instructions/skills"
import { RefreshedSkills, SkillInfo } from "@shared/proto/cline/file"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

function coreSkillToSkillInfo(skill: CoreSettingsItem): SkillInfo {
	return SkillInfo.create({
		name: skill.name,
		description: skill.description ?? "",
		path: skill.path,
		enabled: skill.enabled !== false,
	})
}

/**
 * Refreshes all skill toggles (discovers skills and their enabled state)
 */
export async function refreshSkills(controller: Controller): Promise<RefreshedSkills> {
	// Get workspace paths for local skills
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	const primaryWorkspace = workspacePaths.paths[0]

	const settingsSnapshot = await createCoreSettingsService().list({
		workspaceRoot: primaryWorkspace,
	})
	const globalSkills = settingsSnapshot.skills
		.filter((skill) => skill.source === "global" || skill.source === "global-plugin")
		.map(coreSkillToSkillInfo)
	const localSkills = settingsSnapshot.skills
		.filter((skill) => skill.source === "workspace" || skill.source === "workspace-plugin")
		.map(coreSkillToSkillInfo)

	// Add remote skills from remote config.
	// Precedence: remote (enterprise) > disk-global (user) > project (workspace).
	// Remote entries are appended to globalSkills[] and split into the dedicated "Enterprise Skills"
	// section by the UI. The toggle store distinguishes them by the "remote:" path prefix.
	const remoteConfigSettings = controller.stateManager.getRemoteConfigSettings()
	const remoteSkillsToggles = controller.stateManager.getGlobalStateKey("remoteSkillsToggles") || {}
	const validatedRemoteSkills = parseRemoteSkillEntries(remoteConfigSettings.remoteGlobalSkills || [])

	for (const entry of validatedRemoteSkills) {
		const enabled = entry.alwaysEnabled || remoteSkillsToggles[entry.name] !== false

		globalSkills.push(
			SkillInfo.create({
				name: entry.name,
				description: entry.description,
				path: `remote:${entry.name}`,
				enabled,
				alwaysEnabled: entry.alwaysEnabled,
			}),
		)
	}

	return RefreshedSkills.create({
		globalSkills,
		localSkills,
	})
}
