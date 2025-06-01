import { EmptyRequest, Empty } from "@shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"
import type { Controller } from "../index"

// Keep track of active subscriptions
const activeSettingsButtonClickedSubscriptions = new Set<StreamingResponseHandler>()

/**
 * Subscribe to settings button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToSettingsButtonClicked(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeSettingsButtonClickedSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeSettingsButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "settings_button_clicked_subscription" }, responseStream)
	}
}

/**
 * Send a settings button clicked event to all active subscribers
 */
export async function sendSettingsButtonClickedEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeSettingsButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event: Empty = {}
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending settings button clicked event:", error)
			// Remove the subscription if there was an error
			activeSettingsButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
