import { defaultMcpToolNameTransform } from "@cline/core"
import type { McpServer, McpTool } from "@shared/mcp"

/**
 * The name an MCP tool has in an SDK session. It is `server__tool` unless a
 * model provider would reject that name, in which case the SDK rewrites it
 * and the server and tool can no longer be read back from it. Anything that
 * matches a session's tool against the hub's goes through this or
 * `findMcpTools`.
 */
export function getMcpSdkToolName(serverName: string, toolName: string): string {
	return defaultMcpToolNameTransform({ serverName, toolName })
}

/**
 * The hub's tools that a session has under this name. More than one only when
 * two servers produce the same name, e.g. server `a` with tool `b__c` and
 * server `a__b` with tool `c`.
 */
export function findMcpTools(sdkToolName: string, servers: readonly McpServer[]): { server: McpServer; tool: McpTool }[] {
	const matches: { server: McpServer; tool: McpTool }[] = []
	for (const server of servers) {
		for (const tool of server.tools ?? []) {
			if (getMcpSdkToolName(server.name, tool.name) === sdkToolName) {
				matches.push({ server, tool })
			}
		}
	}
	return matches
}
