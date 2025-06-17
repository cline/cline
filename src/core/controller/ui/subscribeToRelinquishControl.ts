import { Controller } from "../index"
import { EmptyRequest, Empty } from "@shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active subscriptions
const activeRelinquishControlSubscriptions = new Set<StreamingResponseHandler>()

/**
 * Subscribe to relinquish control events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToRelinquishControl(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeRelinquishControlSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeRelinquishControlSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "relinquish_control_subscription" }, responseStream)
	}
}

/**
 * Send a relinquish control event to all active subscribers
 */
export async function sendRelinquishControlEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeRelinquishControlSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending relinquish control event:", error)
			// Remove the subscription if there was an error
			activeRelinquishControlSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
