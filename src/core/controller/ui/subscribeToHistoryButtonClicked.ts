import { Controller } from "../index"
import { EmptyRequest, Empty } from "@shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active subscriptions
const activeHistoryButtonClickedSubscriptions = new Set<StreamingResponseHandler>()

/**
 * Subscribe to history button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToHistoryButtonClicked(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeHistoryButtonClickedSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeHistoryButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "history_button_clicked_subscription" }, responseStream)
	}
}

/**
 * Send a history button clicked event to all active subscribers
 */
export async function sendHistoryButtonClickedEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeHistoryButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event: Empty = {}
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending history button clicked event:", error)
			// Remove the subscription if there was an error
			activeHistoryButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
