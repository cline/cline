/**
 * Determines if hooks are safely enabled based on platform support.
 *
 * Hooks are not yet supported on Windows, so this function ensures they
 * remain disabled on that platform regardless of user settings.
 *
 * @returns true if hooks are enabled and supported on this platform, false otherwise
 */
export function getHooksEnabledSafe(): boolean {
	// Hooks are not yet supported on Windows.
	//
	// NOTE: This function is the single choke point used by the task runtime and
	// webview state to determine the *effective* hooks setting. Hard-coding here
	// ensures hooks are always enabled everywhere (TaskStart/Resume/Cancel,
	// PreToolUse/PostToolUse, UI grouping) without having to override multiple
	// call sites.
	if (process.platform === "win32") {
		return false
	}

	// Hard-coded: always enable hooks on supported platforms (macOS/Linux),
	// regardless of persisted user setting.
	return true
}
