import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active mcpButtonClicked subscriptions by controller ID
const activeMcpButtonClickedSubscriptions = new Map<string, StreamingResponseHandler<Empty>>()

/**
 * Subscribe to mcpButtonClicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToMcpButtonClicked(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	const controllerId = controller.id
	console.log(`[DEBUG] set up mcpButtonClicked subscription for controller ${controllerId}`)

	// Add this subscription to the active subscriptions with the controller ID
	activeMcpButtonClickedSubscriptions.set(controllerId, responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeMcpButtonClickedSubscriptions.delete(controllerId)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "mcpButtonClicked_subscription" }, responseStream)
	}
}

/**
 * Send a mcpButtonClicked event to a specific controller's subscription
 * @param controllerId The ID of the controller to send the event to
 */
export async function sendMcpButtonClickedEvent(controllerId: string): Promise<void> {
	// Get the subscription for this specific controller
	const responseStream = activeMcpButtonClickedSubscriptions.get(controllerId)

	if (!responseStream) {
		console.error(`[DEBUG] No active subscription for controller ${controllerId}`)
		return
	}

	try {
		const event = Empty.create({})
		await responseStream(
			event,
			false, // Not the last message
		)
	} catch (error) {
		console.error(`Error sending mcpButtonClicked event to controller ${controllerId}:`, error)
		// Remove the subscription if there was an error
		activeMcpButtonClickedSubscriptions.delete(controllerId)
	}
}
