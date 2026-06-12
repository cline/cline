/**
 * Pure helpers for identifying ai-hydro MCP servers. Kept dependency-free so it
 * can be unit-tested without dragging in the full tool-handler import chain
 * (telemetry, host providers, etc.).
 */

/**
 * Whether an MCP server belongs to the ai-hydro family, for which the extension
 * injects `_chat_id` + `_workspace` so the Python session resolver can bind this
 * chat to a study and auto-resolve the workspace for file outputs.
 *
 * Users register the same server under several names (`ai-hydro`, `aihydro-tools`,
 * `aihydro`, `aihydro_core`, …). A strict `=== "ai-hydro"` check silently disabled
 * chat↔study binding for every alias — `aihydro_chat_status` always returned
 * `bound:false`. Match the whole family instead. The injected keys are stripped
 * server-side before any tool sees them, so a false positive here is harmless.
 */
export function isAiHydroServerName(serverName: string | undefined): boolean {
	if (!serverName) {
		return false
	}
	return /^ai-?hydro([-_].*)?$/i.test(serverName.trim())
}
