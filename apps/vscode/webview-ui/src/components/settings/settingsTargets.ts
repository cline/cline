export const featureSettingElementId = (featureId: string) => `${featureId}-setting`
export const featureSettingControlId = (featureId: string) => `${featureSettingElementId(featureId)}-control`

export const SETTINGS_NAVIGATION_TARGETS = {
	"api-config": { tabId: "api-config" },
	features: { tabId: "features" },
	checkpoints: {
		tabId: "features",
		elementId: featureSettingElementId("checkpoints"),
		focusElementId: featureSettingControlId("checkpoints"),
	},
	terminal: { tabId: "terminal" },
	general: { tabId: "general" },
	about: { tabId: "about" },
	debug: { tabId: "debug" },
	"remote-config": { tabId: "remote-config" },
} as const

export type SettingsNavigationTarget = keyof typeof SETTINGS_NAVIGATION_TARGETS

export interface SettingsNavigationRequest {
	target: SettingsNavigationTarget
	requestId: number
}

let nextSettingsNavigationRequestId = 0

export const getNextSettingsNavigationRequestId = () => ++nextSettingsNavigationRequestId

export const createSettingsNavigationRequest = (target: SettingsNavigationTarget): SettingsNavigationRequest => ({
	target,
	requestId: getNextSettingsNavigationRequestId(),
})

export interface ResolvedSettingsTarget {
	tabId?: string
	elementId?: string
	focusElementId?: string
}

export const resolveSettingsTarget = (target: string | undefined): ResolvedSettingsTarget | undefined => {
	if (!target) {
		return undefined
	}
	return SETTINGS_NAVIGATION_TARGETS[target as SettingsNavigationTarget] ?? { elementId: target }
}
