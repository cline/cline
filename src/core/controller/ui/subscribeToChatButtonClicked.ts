import { Controller } from "../index"
import { EmptyRequest, Empty } from "@shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active chatButtonClicked subscriptions
const activeChatButtonClickedSubscriptions = new Set<StreamingResponseHandler>()

/**
 * Subscribe to chatButtonClicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToChatButtonClicked(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeChatButtonClickedSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeChatButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "chatButtonClicked_subscription" }, responseStream)
	}
}

/**
 * Send a chatButtonClicked event to all active subscribers
 */
export async function sendChatButtonClickedEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeChatButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event: Empty = {}
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending chatButtonClicked event:", error)
			// Remove the subscription if there was an error
			activeChatButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
