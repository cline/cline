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
	// Force hooks to false on Windows (not yet supported)
	return process.platform === "win32" ? false : (userSetting ?? false)
}
