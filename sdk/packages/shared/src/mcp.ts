/**
 * Per-server MCP request timeout contract, in seconds.
 *
 * The `timeout` field in cline_mcp_settings.json is in SECONDS. Every client
 * (VSCode extension, CLI, JetBrains) resolves it through this module so all
 * apply the same default and bounds. Values above MAX are almost always a
 * milliseconds/seconds mix-up (e.g. `timeout: 60000` meaning 60s), so they
 * clamp instead of silently becoming hours.
 */
export const DEFAULT_MCP_TIMEOUT_SECONDS = 60; // matches Anthropic's default timeout in their MCP SDK
export const MIN_MCP_TIMEOUT_SECONDS = 1;
export const MAX_MCP_TIMEOUT_SECONDS = 3600;

export function isMcpTimeoutConfigured(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Clamp a timeout in seconds into [MIN_MCP_TIMEOUT_SECONDS, MAX_MCP_TIMEOUT_SECONDS].
 */
export function clampMcpTimeoutSeconds(value: number): number {
	return Math.min(
		Math.max(value, MIN_MCP_TIMEOUT_SECONDS),
		MAX_MCP_TIMEOUT_SECONDS,
	);
}

/**
 * Resolve a raw `timeout` value from MCP settings to seconds. Never throws:
 * missing or non-numeric values fall back to the default, so one malformed
 * field cannot take down a whole settings file.
 */
export function resolveMcpTimeoutSeconds(value: unknown): number {
	if (!isMcpTimeoutConfigured(value)) {
		return DEFAULT_MCP_TIMEOUT_SECONDS;
	}
	return clampMcpTimeoutSeconds(value);
}

export function formatMcpTimeoutErrorMessage(
	serverName: string,
	timeoutMs: number,
	method?: string,
): string {
	const methodText = method ? ` (${method})` : "";
	const seconds = Math.round(timeoutMs / 100) / 10;
	return (
		`MCP request to "${serverName}"${methodText} timed out after ${seconds}s. ` +
		`Increase the "timeout" field (in seconds) for this server in cline_mcp_settings.json.`
	);
}
