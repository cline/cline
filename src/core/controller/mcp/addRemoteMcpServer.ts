import type { AddRemoteMcpServerRequest } from "@shared/proto/cline/mcp"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertMcpServersToProtoMcpServers } from "@/shared/proto-conversions/mcp/mcp-server-conversion"
import type { Controller } from "../index"

/**
 * Adds a new remote MCP server via gRPC
 * @param controller The controller instance
 * @param request The request containing server name and URL
 * @returns An array of McpServer objects
 */
export async function addRemoteMcpServer(controller: Controller, request: AddRemoteMcpServerRequest): Promise<McpServers> {
	try {
		// Validate required fields
		if (!request.serverName) {
			throw new Error("Server name is required")
		}
		if (!request.serverUrl) {
			throw new Error("Server URL is required")
		}

		// Optional inputs for first-class transport setup
		const transportType = request.transportType || undefined
		const headers = request.headers && Object.keys(request.headers).length > 0 ? request.headers : undefined
		const timeout = typeof request.timeout === "number" && request.timeout > 0 ? request.timeout : undefined

		// Call the McpHub method to add the remote server with transport details
		const servers = await controller.mcpHub?.addRemoteServer(
			request.serverName,
			request.serverUrl,
			transportType,
			headers,
			timeout,
		)

		const protoServers = convertMcpServersToProtoMcpServers(servers)

		return McpServers.create({ mcpServers: protoServers })
	} catch (error) {
		console.error(`Failed to add remote MCP server ${request.serverName}:`, error)

		throw error
	}
}
