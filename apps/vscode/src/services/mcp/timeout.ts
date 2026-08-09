export { augmentMcpTimeoutError } from "@cline/core"

import { DEFAULT_MCP_CONNECT_TIMEOUT_MS } from "@cline/core"
import { isMcpTimeoutConfigured, resolveMcpTimeoutSeconds } from "@cline/shared"
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
 * Resolve the connect/initialize timeout (ms) for a server from a raw server
 * config JSON string. This applies ONLY to the `client.connect()` step; every
 * post-connect request keeps resolving through resolveMcpServerTimeoutMs.
 *
 * Mirrors SDK core policy (DEFAULT_MCP_CONNECT_TIMEOUT_MS in @cline/core): a
 * stdio server with no explicit `timeout` configured gets a short initialize
 * budget so a hung command fails fast instead of waiting out the 60s request
 * default; slow starters need an explicit `timeout`, which overrides the
 * budget in either direction. Remote (sse/streamableHttp) servers keep the
 * request timeout for connect, exactly as core's SDK-based client does.
 */
export function resolveMcpConnectTimeoutMs(configJson: string): number {
	let config: { type?: unknown; timeout?: unknown } | undefined
	try {
		config = JSON.parse(configJson)
	} catch {
		config = undefined
	}
	if (isMcpTimeoutConfigured(config?.timeout)) {
		return secondsToMs(resolveMcpTimeoutSeconds(config?.timeout))
	}
	if (config?.type === "stdio") {
		return DEFAULT_MCP_CONNECT_TIMEOUT_MS
	}
	return secondsToMs(resolveMcpTimeoutSeconds(undefined))
}
