import { convertMcpServersToProtoMcpServers } from "@/shared/proto-conversions/mcp/mcp-server-conversion"
import { Controller } from ".."
import { UpdateMcpTimeoutRequest, McpServers } from "../../../shared/proto/mcp"

/**
 * Updates the timeout configuration for an MCP server.
 * @param controller - The Controller instance
 * @param request - Contains server name and timeout value
 * @returns Array of updated McpServer objects
 */
export async function updateMcpTimeout(controller: Controller, request: UpdateMcpTimeoutRequest): Promise<McpServers> {
	try {
		if (request.serverName && typeof request.serverName === "string" && typeof request.timeout === "number") {
			const mcpServers = await controller.mcpHub?.updateServerTimeoutRPC(request.serverName, request.timeout)
			const convertedMcpServers = convertMcpServersToProtoMcpServers(mcpServers)
			console.log("convertedMcpServers", convertedMcpServers)
			return McpServers.create({ mcpServers: convertedMcpServers })
		} else {
			console.error("Server name and timeout are required")
			throw new Error("Server name and timeout are required")
		}
	} catch (error) {
		console.error(`Failed to update timeout for server ${request.serverName}:`, error)
		throw error
	}
}
