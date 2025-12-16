/**
 * Determines if hooks are safely enabled based on platform support.
 *
 * Hooks are not yet supported on Windows, so this function ensures they
 * remain disabled on that platform regardless of user settings.
 *
 * @param userSetting The user's hooks enabled setting from global state (may be undefined)
 * @returns true if hooks are enabled and supported on this platform, false otherwise
 */
export function getHooksEnabledSafe(userSetting: boolean | undefined): boolean {
	// Handle legacy ClineFeatureSetting object format {user: boolean, featureFlag: boolean}
	// This can occur if the migration hasn't run yet or if reading from an old state
	let booleanValue: boolean
	if (typeof userSetting === "object" && userSetting !== null) {
		// Legacy format - extract the user preference
		booleanValue = (userSetting as any).user === true
	} else {
		// Modern boolean format or undefined
		booleanValue = userSetting ?? false
	}

	// Force hooks to false on Windows (not yet supported)
	return process.platform === "win32" ? false : booleanValue
}
