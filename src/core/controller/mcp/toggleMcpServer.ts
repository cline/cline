import type { ToggleMcpServerRequest, ToggleMcpServer } from "../../../shared/proto/mcp"
import type { Controller } from "../index"

/**
 * Toggles an MCP server's enabled/disabled status
 * @param controller The controller instance
 * @param request The request containing server ID and disabled status
 * @returns A response indicating success or failure
 */
export async function toggleMcpServer(controller: Controller, request: ToggleMcpServerRequest): Promise<ToggleMcpServer> {
	try {
		if (!controller.mcpHub) {
			return {
				success: false,
				error: "MCP hub not initialized",
			}
		}

		const { serverId, disabled } = {
			serverId: request.serverId,
			disabled: request.disabled,
		}

		// Call the existing mcpHub method to toggle the server status
		await controller.mcpHub.toggleServerDisabled(serverId, disabled)

		return {
			success: true,
			error: "",
		}
	} catch (error) {
		console.error(`Failed to toggle MCP server ${request.serverId}:`, error)
		return {
			success: false,
			error: `Failed to ${request.disabled ? "disable" : "enable"} MCP server ${request.serverId}: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}
