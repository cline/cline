import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

// Keep track of active focus chat input subscriptions
const focusChatInputSubscriptions = new Set<StreamingResponseHandler<Empty>>()

/**
 * Subscribe to focus chat input events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToFocusChatInput(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	focusChatInputSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		focusChatInputSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "focus_chat_input_subscription" }, responseStream)
	}
}

/**
 * Send a focus chat input event to all active subscribers
 */
export async function sendFocusChatInputEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(focusChatInputSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending focus chat input event:", error)
			// Remove the subscription if there was an error
			focusChatInputSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
