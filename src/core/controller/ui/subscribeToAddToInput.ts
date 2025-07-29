import { Controller } from "../index"
import { EmptyRequest } from "@shared/proto/cline/common"
import { String as ProtoString } from "@shared/proto/cline/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active addToInput subscriptions
const activeAddToInputSubscriptions = new Set<StreamingResponseHandler<ProtoString>>()

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
	console.log("[DEBUG] set up addToInput subscription")

	// Add this subscription to the active subscriptions
	activeAddToInputSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeAddToInputSubscriptions.delete(responseStream)
		console.log("[DEBUG] Cleaned up addToInput subscription")
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "addToInput_subscription" }, responseStream)
	}
}

/**
 * Send an addToInput event to all active subscribers
 * @param text The text to add to the input
 */
export async function sendAddToInputEvent(text: string): Promise<void> {
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
			console.log("[DEBUG] sending addToInput event", text.length, "chars")
		} catch (error) {
			console.error("Error sending addToInput event:", error)
			// Remove the subscription if there was an error
			activeAddToInputSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
