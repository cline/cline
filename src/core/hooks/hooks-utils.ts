/**
 * Computes the effective hooks-enabled state from persisted user setting and
 * platform policy.
 *
 * NOTE: This is the single choke point used by runtime and UI state shaping.
 */
export function getHooksEnabledSafe(userSetting: boolean | { user?: boolean; featureFlag?: boolean } | undefined): boolean {
	if (typeof userSetting === "object" && userSetting !== null) {
		userSetting = userSetting.user ?? false
	}

	if (!userSetting) {
		return false
	}

	// Hooks are currently supported on all desktop platforms.
	return true
}
