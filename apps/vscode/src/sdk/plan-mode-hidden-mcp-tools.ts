import type { McpServer } from "@shared/mcp"
import { getMcpPlanModeAccess } from "@shared/mcp-plan-mode"
import { getMcpToolsBySdkName } from "./mcp-sdk-tool-name"

/**
 * The MCP tools a Plan-mode session is built without, per server, and the
 * system prompt section that names them. Naming them lets the model plan
 * around tools it will have in Act mode without carrying their schemas or
 * spending turns on calls that cannot succeed.
 */
export function describeMcpToolsHiddenInPlanMode(servers: readonly McpServer[]): {
	servers: { serverName: string; hiddenCount: number; toolCount: number }[]
	promptSection: string | undefined
} {
	const hiddenToolNames: string[] = []
	const hiddenCounts = new Map<string, number>()
	// Only a tool that has its session name is in sessions at all.
	for (const [sdkToolName, { server, tool }] of getMcpToolsBySdkName(servers)) {
		if (getMcpPlanModeAccess(tool, server) === "hidden") {
			hiddenToolNames.push(sdkToolName)
			hiddenCounts.set(server.name, (hiddenCounts.get(server.name) ?? 0) + 1)
		}
	}
	const summaries = servers
		.filter((server) => hiddenCounts.has(server.name))
		.map((server) => ({
			serverName: server.name,
			hiddenCount: hiddenCounts.get(server.name) ?? 0,
			toolCount: server.tools?.length ?? 0,
		}))
	return {
		servers: summaries,
		promptSection:
			hiddenToolNames.length > 0
				? `# MCP Tools Available In Act Mode Only\n\nThese MCP tools make changes, so they are not available in Plan mode: ${hiddenToolNames.join(", ")}. You can include them in your plan, but you cannot call them until the user switches to Act mode.`
				: undefined,
	}
}
