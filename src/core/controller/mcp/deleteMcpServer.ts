import type { Controller } from "../index"
import type { DeleteMcpServerRequest, McpServers } from "../../../shared/proto/mcp"
import { convertMcpServersToProtoMcpServers } from "../../../shared/proto-conversions/mcp/mcp-server-conversion"

/**
 * Deletes an MCP server
 * @param controller The controller instance
 * @param request The delete server request
 * @returns The list of remaining MCP servers after deletion
 */
export async function deleteMcpServer(controller: Controller, request: DeleteMcpServerRequest): Promise<McpServers> {
	try {
		// Call the RPC variant to delete the server and get updated server list
		const mcpServers = (await controller.mcpHub?.deleteServerRPC(request.serverName)) || []

		// Convert application types to protobuf types
		const protoServers = convertMcpServersToProtoMcpServers(mcpServers)

		return { mcpServers: protoServers }
	} catch (error) {
		console.error(`Failed to delete MCP server: ${error}`)
		throw error
	}
}
