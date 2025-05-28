import type { EmptyRequest } from "../../../shared/proto/common"
import type { McpMarketplaceCatalog } from "../../../shared/proto/mcp"
import type { Controller } from "../index"

/**
 * RPC handler that silently refreshes the MCP marketplace catalog
 * @param controller Controller instance
 * @param _request Empty request
 * @returns MCP marketplace catalog
 */
export async function refreshMcpMarketplace(controller: Controller, _request: EmptyRequest): Promise<McpMarketplaceCatalog> {
	try {
		// Call the RPC variant which returns the result directly
		const catalog = await controller.silentlyRefreshMcpMarketplaceRPC()

		if (catalog) {
			// Types are structurally identical, use direct type assertion
			return catalog as McpMarketplaceCatalog
		}

		// Return empty catalog if nothing was fetched
		return { items: [] }
	} catch (error) {
		console.error("Failed to refresh MCP marketplace:", error)
		return { items: [] }
	}
}
