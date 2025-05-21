import type { ToggleToolAutoApproveRequest, McpServers } from "@shared/proto/mcp"
import type { Controller } from "../index"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"

/**
 * Toggles auto-approve setting for MCP server tools
 * @param controller The controller instance
 * @param request The toggle tool auto-approve request
 * @returns Updated list of MCP servers
 */
export async function toggleToolAutoApprove(controller: Controller, request: ToggleToolAutoApproveRequest): Promise<McpServers> {
	try {
		// Call the RPC variant that returns the servers directly
		const mcpServers =
			(await controller.mcpHub?.toggleToolAutoApproveRPC(request.serverName, request.toolNames, request.autoApprove)) || []

		// Convert application types to proto types
		return { mcpServers: convertMcpServersToProtoMcpServers(mcpServers) }
	} catch (error) {
		console.error(`Failed to toggle tool auto-approve for ${request.serverName}:`, error)
		throw error
	}
}
