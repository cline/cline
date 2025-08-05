import { Controller } from "../index"
import { EmptyRequest } from "@shared/proto/cline/common"
import { McpMarketplaceCatalog } from "@shared/proto/cline/mcp"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active subscriptions
const activeMcpMarketplaceSubscriptions = new Set<StreamingResponseHandler<McpMarketplaceCatalog>>()

/**
 * Subscribe to MCP marketplace catalog updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToMcpMarketplaceCatalog(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<McpMarketplaceCatalog>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeMcpMarketplaceSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeMcpMarketplaceSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "mcp_marketplace_subscription" }, responseStream)
	}
}

/**
 * Send an MCP marketplace catalog event to all active subscribers
 */
export async function sendMcpMarketplaceCatalogEvent(catalog: McpMarketplaceCatalog): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeMcpMarketplaceSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				catalog,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending MCP marketplace catalog event:", error)
			// Remove the subscription if there was an error
			activeMcpMarketplaceSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
