/**
 * Focus chain settings type. Focus chain feature has been removed,
 * but this type is preserved for backward compatibility with stored settings.
 */
export interface FocusChainSettings {
	enabled: boolean
	remindClineInterval: number
}

export const DEFAULT_FOCUS_CHAIN_SETTINGS: FocusChainSettings = {
	enabled: false,
	remindClineInterval: 6,
}
