import { McpServers } from "@shared/proto/cline/mcp"
import type { Controller } from "../index"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { StringRequest } from "@shared/proto/cline/common"

/**
 * Restarts an MCP server connection
 * @param controller The controller instance
 * @param request The request containing the server name
 * @returns The updated list of MCP servers
 */
export async function restartMcpServer(controller: Controller, request: StringRequest): Promise<McpServers> {
	try {
		const mcpServers = await controller.mcpHub?.restartConnectionRPC(request.value)

		// Convert from McpServer[] to ProtoMcpServer[] ensuring all required fields are set
		const protoServers = convertMcpServersToProtoMcpServers(mcpServers)

		return McpServers.create({ mcpServers: protoServers })
	} catch (error) {
		console.error(`Failed to restart MCP server ${request.value}:`, error)
		throw error
	}
}
