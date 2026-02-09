import { BeadUpdateEvent } from "@shared/proto/beadsmith/bead"
import { EmptyRequest } from "@shared/proto/beadsmith/common"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active bead update subscriptions
const activeBeadUpdateSubscriptions = new Set<StreamingResponseHandler<BeadUpdateEvent>>()

/**
 * Subscribe to bead update events
 * @param controller The controller instance
 * @param _request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToBeadUpdates(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<BeadUpdateEvent>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeBeadUpdateSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeBeadUpdateSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "bead_update_subscription" }, responseStream)
	}
}

/**
 * Send a bead update event to all active subscribers
 * @param event The BeadUpdateEvent to send
 */
export async function sendBeadUpdateEvent(event: BeadUpdateEvent): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeBeadUpdateSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending bead update event:", error)
			// Remove the subscription if there was an error
			activeBeadUpdateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
