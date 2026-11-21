import type { SetPlanModeAccessRequest } from "@shared/proto/cline/mcp"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Allows or disallows MCP tools in Plan mode, for single tools or a whole server
 * @param controller The controller instance
 * @param request The server, the tools or the whole-server flag, and the new value
 * @returns Updated list of MCP servers
 */
export async function setPlanModeAccess(controller: Controller, request: SetPlanModeAccessRequest): Promise<McpServers> {
	try {
		const mcpServers =
			(await controller.mcpHub?.setPlanModeAccess(
				request.serverName,
				request.allowed,
				request.wholeServer ? undefined : request.toolNames,
			)) || []
		return McpServers.create({ mcpServers: convertMcpServersToProtoMcpServers(mcpServers) })
	} catch (error) {
		Logger.error(`Failed to set Plan mode access for ${request.serverName}:`, error)
		throw error
	}
}
