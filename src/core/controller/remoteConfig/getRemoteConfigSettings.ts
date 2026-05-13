import { Controller } from "@/sdk"
import { Empty, RemoteConfigSetting, RemoteConfigSettingsResponse, RemoteConfigType } from "@/shared/proto/index.cline"

export async function getRemoteConfigSettings(controller: Controller, _request: Empty): Promise<RemoteConfigSettingsResponse> {
	const globalRules: RemoteConfigSetting[] = (controller.remoteConfig?.globalRules || []).map((rule) => ({
		type: RemoteConfigType.RULE,
		name: rule.name,
		content: rule.contents,
		enabled: true, // TODO: Implement actual enabled state based on controller state
		locked: rule.alwaysEnabled,
	}))
	const globalWorkflows: RemoteConfigSetting[] = (controller.remoteConfig?.globalWorkflows || []).map((workflow) => ({
		type: RemoteConfigType.WORKFLOW,
		name: workflow.name,
		content: workflow.contents,
		enabled: true, // TODO: Implement actual enabled state based on controller state
		locked: workflow.alwaysEnabled,
	}))
	return RemoteConfigSettingsResponse.create({ settings: [...globalRules, ...globalWorkflows] })
}
