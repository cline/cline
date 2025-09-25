import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

// Keep track of active settings button clicked subscriptions
const activeSettingsButtonClickedSubscriptions = new Set<StreamingResponseHandler<Empty>>()

/**
 * Subscribe to settings button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToSettingsButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
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
			const event = Empty.create({})
			await responseStream(event, false) // Not the last message
		} catch (error) {
			console.error("Error sending settings button clicked event:", error)
			activeSettingsButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
