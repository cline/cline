import { defaultMcpToolNameTransform } from "@cline/core"
import type { McpServer, McpTool } from "@shared/mcp"

type HubTool = { server: McpServer; tool: McpTool }

/**
 * The name an MCP tool has in an SDK session. It is `server__tool` unless a
 * model provider would reject that name, in which case the SDK rewrites it
 * and the server and tool can no longer be read back from it. Anything that
 * matches a session's tool against the hub's goes through this module.
 */
export function getMcpSdkToolName(serverName: string, toolName: string): string {
	return defaultMcpToolNameTransform({ serverName, toolName })
}

/**
 * The hub's tools by the name a session has them under. A session keeps one
 * tool per name, so when two tools produce the same one, e.g. server `a` with
 * tool `b__c` and server `a__b` with tool `c`, the first in the hub's order
 * has the name and the other is left out of sessions.
 */
export function getMcpToolsBySdkName(servers: readonly McpServer[]): Map<string, HubTool> {
	const tools = new Map<string, HubTool>()
	for (const server of servers) {
		for (const tool of server.tools ?? []) {
			const sdkToolName = getMcpSdkToolName(server.name, tool.name)
			if (!tools.has(sdkToolName)) {
				tools.set(sdkToolName, { server, tool })
			}
		}
	}
	return tools
}

/** The hub's tool that a session has under this name, as in `getMcpToolsBySdkName`. */
export function findMcpTool(sdkToolName: string, servers: readonly McpServer[]): HubTool | undefined {
	for (const server of servers) {
		for (const tool of server.tools ?? []) {
			if (getMcpSdkToolName(server.name, tool.name) === sdkToolName) {
				return { server, tool }
			}
		}
	}
	return undefined
}
