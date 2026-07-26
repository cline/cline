import { type CoreSettingsItem, createCoreSettingsService } from "@bedrock-coder/core"
import { RefreshedSkills, SkillInfo } from "@shared/proto/bedrock_coder/file"
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

	return RefreshedSkills.create({
		globalSkills,
		localSkills,
	})
}
