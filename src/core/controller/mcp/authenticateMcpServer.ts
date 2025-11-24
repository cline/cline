import type { StringRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Initiates OAuth authentication for an MCP server
 * @param controller The controller instance
 * @param request The request containing server name
 * @returns Empty response
 */
export async function authenticateMcpServer(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const serverName = request.value
		if (!serverName) {
			throw new Error("Server name is required")
		}

		// Call the McpHub method to initiate OAuth
		await controller.mcpHub?.initiateOAuth(serverName)

		return Empty.create()
	} catch (error) {
		console.error(`Failed to initiate OAuth for MCP server:`, error)
		throw error
	}
}
