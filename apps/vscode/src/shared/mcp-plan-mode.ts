import type { McpServer, McpTool } from "./mcp"

/**
 * What Plan mode does with an MCP tool.
 *
 * - `allowed`: the model can call it, under the same approval rules as in Act
 *   mode. The server declares it read-only, or the user allowed it.
 * - `hidden`: the model does not get the tool. The server declares that it
 *   modifies things.
 * - `ask`: the model can call it, but every call needs approval. The server
 *   says nothing, so the tool may or may not modify things.
 *
 * `readOnlyHint` is the server's own claim and is not verified.
 */
export function getMcpPlanModeAccess(
	tool: Pick<McpTool, "annotations" | "allowInPlanMode">,
	server?: Pick<McpServer, "allowAllInPlanMode">,
): "allowed" | "hidden" | "ask" {
	if (tool.annotations?.readOnlyHint === true || tool.allowInPlanMode || server?.allowAllInPlanMode) {
		return "allowed"
	}
	return tool.annotations?.readOnlyHint === false ? "hidden" : "ask"
}
