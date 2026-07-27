export { augmentMcpTimeoutError } from "@cline/core"

import { resolveMcpTimeoutSeconds } from "@cline/shared"
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
