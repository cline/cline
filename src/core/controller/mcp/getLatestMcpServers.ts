import type { Empty } from "@shared/proto/common"
import { McpServers } from "@shared/proto/mcp"
import type { Controller } from "../index"
import { convertMcpServersToProtoMcpServers } from "@/shared/proto-conversions/mcp/mcp-server-conversion"

/**
 * RPC handler for getting the latest MCP servers
 * @param controller The controller instance
 * @param _request Empty request
 * @returns McpServers response with list of all MCP servers
 */
export async function getLatestMcpServers(controller: Controller, _request: Empty): Promise<McpServers> {
	try {
		// Get sorted servers from mcpHub using the RPC variant
		const mcpServers = (await controller.mcpHub?.getLatestMcpServersRPC()) || []

		// Convert to proto format
		const protoServers = convertMcpServersToProtoMcpServers(mcpServers)

		return McpServers.create({ mcpServers: protoServers })
	} catch (error) {
		console.error("Error fetching latest MCP servers:", error)
		throw error
	}
}
