import { AddRemoteServer, AddRemoteServerRequest } from "@/shared/proto/mcp"
import { Controller } from ".."
import { convertMcpServersToProtoMcpServers } from "@/shared/proto-conversions/mcp/mcp-server-conversion"

/**
 * Add a remote MCP server
 * @param controller The controller instance
 * @param request The request message
 * @returns The result of adding the remote server
 */
export async function addRemoteServer(controller: Controller, request: AddRemoteServerRequest): Promise<AddRemoteServer> {
	try {
		const mcpServers = await controller.mcpHub?.addRemoteServerRPC(request.serverName, request.serverUrl)

		const mcpServersProto = convertMcpServersToProtoMcpServers(mcpServers)
		return {
			success: true,
			serverName: request.serverName,
			mcpServers: mcpServersProto,
		}
	} catch (error) {
		return {
			success: false,
			serverName: request.serverName,
			error: error instanceof Error ? error.message : String(error),
			mcpServers: [], // Empty array for error case
		}
	}
}
