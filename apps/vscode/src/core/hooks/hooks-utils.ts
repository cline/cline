/**
 * Computes the effective hooks-enabled state from persisted user setting.
 *
 * NOTE: This is the single choke point used by runtime and UI state shaping.
 */
export function getHooksEnabledSafe(userSetting: boolean | undefined): boolean {
	return userSetting ?? true
}
