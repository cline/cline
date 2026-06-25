import { Controller } from "@/sdk"
import { Empty, RemoteConfigSetting, RemoteConfigSettingsResponse, RemoteConfigType } from "@/shared/proto/index.cline"

export async function getRemoteConfigSettings(controller: Controller, _request: Empty): Promise<RemoteConfigSettingsResponse> {
	const globalRules: RemoteConfigSetting[] = (controller.remoteConfig?.globalRules || []).map((rule) => ({
		type: RemoteConfigType.RULE,
		name: rule.name,
		content: rule.contents,
		enabled: true, // TODO: Implement actual enabled state when toggle support is wired up
		locked: Boolean(rule.alwaysEnabled),
	}))
	const globalWorkflows: RemoteConfigSetting[] = (controller.remoteConfig?.globalWorkflows || []).map((workflow) => ({
		type: RemoteConfigType.WORKFLOW,
		name: workflow.name,
		content: workflow.contents,
		enabled: true, // TODO: Implement actual enabled state when toggle support is wired up
		locked: Boolean(workflow.alwaysEnabled),
	}))
	const managedSkills: RemoteConfigSetting[] = (controller.remoteConfigBundle?.managedInstructions || [])
		.filter((instruction) => instruction.kind === "skill")
		.map((skill) => ({
			type: RemoteConfigType.SKILL,
			name: skill.name,
			content: skill.contents,
			enabled: true, // TODO: Implement actual enabled state when toggle support is wired up
			locked: Boolean(skill.alwaysEnabled),
		}))

	return RemoteConfigSettingsResponse.create({ settings: [...globalRules, ...globalWorkflows, ...managedSkills] })
}
