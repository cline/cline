import type { Controller } from "@/sdk"
import { RemoteConfigSetting, RemoteConfigType } from "@/shared/proto/index.cline"

function getToggles(controller: Controller, type: RemoteConfigType): Record<string, boolean> {
	switch (type) {
		case RemoteConfigType.RULE:
			return controller.stateManager.getGlobalStateKey("remoteRulesToggles") || {}
		case RemoteConfigType.WORKFLOW:
			return controller.stateManager.getGlobalStateKey("remoteWorkflowToggles") || {}
		case RemoteConfigType.SKILL:
			return controller.stateManager.getGlobalStateKey("remoteSkillsToggles") || {}
		default:
			throw new Error(`Invalid remote config type: ${type}`)
	}
}

function getInstructions(controller: Controller, type: RemoteConfigType) {
	const remoteConfig = controller.stateManager.getRemoteConfigSettings()
	switch (type) {
		case RemoteConfigType.RULE:
			return remoteConfig.remoteGlobalRules ?? []
		case RemoteConfigType.WORKFLOW:
			return remoteConfig.remoteGlobalWorkflows ?? []
		case RemoteConfigType.SKILL:
			return remoteConfig.remoteGlobalSkills ?? []
		default:
			throw new Error(`Invalid remote config type: ${type}`)
	}
}

export function getRemoteConfigSetting(controller: Controller, type: RemoteConfigType, name: string): RemoteConfigSetting {
	const instruction = getInstructions(controller, type).find((entry) => entry.name === name)
	if (!instruction) {
		throw new Error(`Managed ${RemoteConfigType[type]?.toLowerCase() ?? "setting"} not found: ${name}`)
	}

	const locked = Boolean(instruction.alwaysEnabled)
	return RemoteConfigSetting.create({
		type,
		name: instruction.name,
		content: instruction.contents,
		enabled: locked || getToggles(controller, type)[name] !== false,
		locked,
	})
}

export function getAllRemoteConfigSettings(controller: Controller): RemoteConfigSetting[] {
	return [RemoteConfigType.RULE, RemoteConfigType.WORKFLOW, RemoteConfigType.SKILL].flatMap((type) =>
		getInstructions(controller, type).map((entry) => getRemoteConfigSetting(controller, type, entry.name)),
	)
}
