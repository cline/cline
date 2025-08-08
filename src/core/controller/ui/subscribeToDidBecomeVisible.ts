import { Controller } from "../index"
import { Empty } from "@shared/proto/common"
import { EmptyRequest } from "@shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active didBecomeVisible subscriptions by controller ID
const activeDidBecomeVisibleSubscriptions = new Map<string, StreamingResponseHandler>()

/**
 * Subscribe to didBecomeVisible events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToDidBecomeVisible(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	const controllerId = controller.id
	console.log(`[DEBUG] set up didBecomeVisible subscription for controller ${controllerId}`)

	// Add this subscription to the active subscriptions with the controller ID
	activeDidBecomeVisibleSubscriptions.set(controllerId, responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeDidBecomeVisibleSubscriptions.delete(controllerId)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "didBecomeVisible_subscription" }, responseStream)
	}
}

/**
 * Send a didBecomeVisible event to a specific controller's subscription
 * @param controllerId The ID of the controller to send the event to
 */
export async function sendDidBecomeVisibleEvent(controllerId: string): Promise<void> {
	// Get the subscription for this specific controller
	const responseStream = activeDidBecomeVisibleSubscriptions.get(controllerId)

	if (!responseStream) {
		console.log(`[DEBUG] No active subscription for controller ${controllerId}`)
		return
	}

	try {
		const event: Empty = Empty.create({})
		await responseStream(
			event,
			false, // Not the last message
		)
	} catch (error) {
		console.error(`Error sending didBecomeVisible event to controller ${controllerId}:`, error)
		// Remove the subscription if there was an error
		activeDidBecomeVisibleSubscriptions.delete(controllerId)
	}
}
