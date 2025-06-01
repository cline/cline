import { Controller } from "../index"
import { EmptyRequest, Empty } from "@shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active mcpButtonClicked subscriptions
const activeMcpButtonClickedSubscriptions = new Set<StreamingResponseHandler>()

/**
 * Subscribe to mcpButtonClicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToMcpButtonClicked(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeMcpButtonClickedSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeMcpButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "mcpButtonClicked_subscription" }, responseStream)
	}
}

/**
 * Send a mcpButtonClicked event to all active subscribers
 */
export async function sendMcpButtonClickedEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeMcpButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event: Empty = {}
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending mcpButtonClicked event:", error)
			// Remove the subscription if there was an error
			activeMcpButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
