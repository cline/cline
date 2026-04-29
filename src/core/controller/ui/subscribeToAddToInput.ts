import type { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

// Keep track of active addToInput subscriptions
const activeAddToInputSubscriptions = new Set<StreamingResponseHandler<ProtoString>>()

// Pending text to send when a subscriber connects
let pendingAddToInputText: string | null = null

/**
 * Subscribe to addToInput events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToAddToInput(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ProtoString>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeAddToInputSubscriptions.add(responseStream)

	// If there was pending text waiting for a subscriber, send it now
	if (pendingAddToInputText !== null) {
		const text = pendingAddToInputText
		pendingAddToInputText = null
		await sendAddToInputEvent(text)
	}

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeAddToInputSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "addToInput_subscription" }, responseStream)
	}
}

/**
 * Send an addToInput event to all active subscribers.
 * If no subscribers are active (e.g. panel not yet initialized), the text is
 * queued and will be delivered when the first subscriber connects.
 * @param text The text to add to the input
 */
export async function sendAddToInputEvent(text: string): Promise<void> {
	if (activeAddToInputSubscriptions.size === 0) {
		pendingAddToInputText = text
		return
	}

	// Send the event to all active subscribers
	const promises = Array.from(activeAddToInputSubscriptions).map(async (responseStream) => {
		try {
			const event: ProtoString = {
				value: text,
			}
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending addToInput event:", error)
			// Remove the subscription if there was an error
			activeAddToInputSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
