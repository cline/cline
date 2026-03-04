/**
 * Computes the effective hooks-enabled state from persisted user setting and
 * platform policy.
 *
 * NOTE: This is the single choke point used by runtime and UI state shaping.
 */
export function getHooksEnabledSafe(userSetting: boolean | undefined): boolean {
	if (!userSetting) {
		return false
	}

	// Hooks are currently supported on all desktop platforms.
	return true
}
