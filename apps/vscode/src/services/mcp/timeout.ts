import { resolveMcpTimeoutSeconds } from "@cline/shared"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import { secondsToMs } from "@utils/time"

/**
 * Resolve the per-server MCP request timeout (ms) from a raw server config
 * JSON string (the `timeout` field, in seconds). Never throws: a malformed
 * config yields the shared default so one bad value cannot break a server.
 *
 * This is the single resolver for every request the extension sends to an
 * MCP server — tools/call, tools/list, resources/*, prompts/* — so all of
 * them agree on the same bound. The config is re-read on each call, so a
 * changed timeout takes effect on the next request.
 */
export function resolveMcpServerTimeoutMs(configJson: string): number {
	try {
		return secondsToMs(resolveMcpTimeoutSeconds(JSON.parse(configJson)?.timeout))
	} catch {
		return secondsToMs(resolveMcpTimeoutSeconds(undefined))
	}
}

/**
 * If `error` is an MCP request timeout, return an equivalent McpError whose
 * message names the bound and how to raise it; otherwise return the error
 * unchanged.
 */
export function augmentMcpTimeoutError(error: unknown, serverName: string, timeoutMs: number): unknown {
	if (!(error instanceof McpError) || error.code !== ErrorCode.RequestTimeout) {
		return error
	}
	return new McpError(
		error.code,
		`MCP request to "${serverName}" timed out after ${Math.round(timeoutMs / 1000)}s. ` +
			`Increase the "timeout" field (in seconds) for this server in cline_mcp_settings.json.`,
		error.data,
	)
}
