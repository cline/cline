import type { ApiConfiguration } from "@/shared/api"

function isModeKey(key: string, prefix: "planMode" | "actMode"): boolean {
	return key.startsWith(prefix) && key.length > prefix.length
}

function collectModeSuffixes(config: ApiConfiguration): Set<string> {
	const suffixes = new Set<string>()
	for (const key of Object.keys(config)) {
		if (isModeKey(key, "planMode")) {
			suffixes.add(key.slice("planMode".length))
		} else if (isModeKey(key, "actMode")) {
			suffixes.add(key.slice("actMode".length))
		}
	}
	return suffixes
}

function chooseSharedValue(planValue: unknown, actValue: unknown): unknown {
	return actValue !== undefined ? actValue : planValue
}

export function mirrorPlanActApiConfiguration(config: ApiConfiguration): ApiConfiguration {
	const next: ApiConfiguration = { ...config }
	for (const suffix of collectModeSuffixes(config)) {
		const planKey = `planMode${suffix}` as keyof ApiConfiguration
		const actKey = `actMode${suffix}` as keyof ApiConfiguration
		const sharedValue = chooseSharedValue(next[planKey], next[actKey])
		if (sharedValue === undefined) {
			continue
		}
		next[planKey] = sharedValue as never
		next[actKey] = sharedValue as never
	}
	return next
}

function apiConfigurationsEqual(left: ApiConfiguration, right: ApiConfiguration): boolean {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)])
	for (const key of keys) {
		if (left[key as keyof ApiConfiguration] !== right[key as keyof ApiConfiguration]) {
			return false
		}
	}
	return true
}

export function ensureSharedModeApiConfiguration(controller: {
	stateManager: {
		getApiConfiguration(): ApiConfiguration
		getGlobalSettingsKey(key: "planActSeparateModelsSetting"): boolean
		setApiConfiguration(config: ApiConfiguration): void
		setGlobalState(key: "planActSeparateModelsSetting", value: boolean): void
	}
}): ApiConfiguration {
	const current = controller.stateManager.getApiConfiguration()
	const next = mirrorPlanActApiConfiguration(current)
	if (!apiConfigurationsEqual(current, next)) {
		controller.stateManager.setApiConfiguration(next)
	}
	if (controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting") !== false) {
		controller.stateManager.setGlobalState("planActSeparateModelsSetting", false)
	}
	return next
}
