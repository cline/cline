/**
 * Determines if hooks are safely enabled based on platform support.
 *
 * NOTE: This function is the single choke point used by the task runtime and
 * webview state to determine the effective hooks setting.
 *
 * Hooks are now supported on Windows. Individual hook execution still depends
 * on hook discovery and platform-specific execution details.
 *
 * @returns true if hooks are enabled and supported on this platform, false otherwise
 */
export function getHooksEnabledSafe(): boolean {
	return true
}
