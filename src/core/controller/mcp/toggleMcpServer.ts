import type { ToggleMcpServerRequest } from "@shared/proto/cline/mcp"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertMcpServersToProtoMcpServers } from "../../../shared/proto-conversions/mcp/mcp-server-conversion"
import type { Controller } from "../index"

/**
 * Toggles an MCP server's enabled/disabled status
 * @param controller The controller instance
 * @param request The request containing server ID and disabled status
 * @returns A response indicating success or failure
 */
export async function toggleMcpServer(controller: Controller, request: ToggleMcpServerRequest): Promise<McpServers> {
	try {
		const mcpServers = await controller.mcpHub?.toggleServerDisabledRPC(request.serverName, request.disabled)

		// Convert from McpServer[] to ProtoMcpServer[] ensuring all required fields are set
		const protoServers = convertMcpServersToProtoMcpServers(mcpServers)

		return McpServers.create({ mcpServers: protoServers })
	} catch (error) {
		console.error(`Failed to toggle MCP server ${request.serverName}:`, error)
		throw error
	}
}
