import type { Controller } from "../index"
import { McpServers } from "../../../shared/proto/mcp"
import { convertMcpServersToProtoMcpServers } from "../../../shared/proto-conversions/mcp/mcp-server-conversion"
import { StringRequest } from "@/shared/proto/common"

/**
 * Deletes an MCP server
 * @param controller The controller instance
 * @param request The delete server request
 * @returns The list of remaining MCP servers after deletion
 */
export async function deleteMcpServer(controller: Controller, request: StringRequest): Promise<McpServers> {
	try {
		// Call the RPC variant to delete the server and get updated server list
		const mcpServers = (await controller.mcpHub?.deleteServerRPC(request.value)) || []

		// Convert application types to protobuf types
		const protoServers = convertMcpServersToProtoMcpServers(mcpServers)

		return McpServers.create({ mcpServers: protoServers })
	} catch (error) {
		console.error(`Failed to delete MCP server: ${error}`)
		throw error
	}
}
