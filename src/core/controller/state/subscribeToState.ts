import { EmptyRequest } from "../../../shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"
import { Controller } from "../index"

// Replace global Set with Map grouped by controller ID
const controllerSubscriptions = new Map<string, Set<StreamingResponseHandler>>()

/**
 * Subscribe to state updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToState(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	const controllerId = controller.id

	// Get or create subscription set for this controller
	if (!controllerSubscriptions.has(controllerId)) {
		controllerSubscriptions.set(controllerId, new Set())
	}
	const subscriptions = controllerSubscriptions.get(controllerId)!

	// Send the initial state
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)

	console.log(`[DEBUG] set up state subscription for controller ${controllerId}`)

	await responseStream({
		stateJson: initialStateJson,
	})

	// Add this subscription to THIS controller's subscriptions
	subscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		subscriptions.delete(responseStream)
		// Clean up empty sets
		if (subscriptions.size === 0) {
			controllerSubscriptions.delete(controllerId)
		}
		console.log(`[DEBUG] Cleaned up state subscription for controller ${controllerId}`)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}
}

/**
 * Send a state update to subscribers of a specific controller
 * @param controllerId The ID of the controller whose subscribers should receive the update
 * @param state The state to send
 */
export async function sendStateUpdateForController(controllerId: string, state: any): Promise<void> {
	const subscriptions = controllerSubscriptions.get(controllerId)
	if (!subscriptions || subscriptions.size === 0) {
		return // No subscribers for this controller
	}

	const stateJson = JSON.stringify(state)

	// Send the update to this controller's subscribers only
	const promises = Array.from(subscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				{
					stateJson,
				},
				false, // Not the last message
			)
			console.log(`[DEBUG] sending followup state to controller ${controllerId}`, stateJson.length, "chars")
		} catch (error) {
			console.error(`Error sending state update to controller ${controllerId}:`, error)
			// Remove the subscription if there was an error
			subscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

/**
 * @deprecated Use sendStateUpdateForController instead
 * Legacy function - will broadcast to ALL controllers (the bug!)
 */
export async function sendStateUpdate(state: any): Promise<void> {
	console.warn("[DEPRECATED] sendStateUpdate called - this broadcasts to all controllers!")

	// For now, broadcast to all controllers to maintain backward compatibility
	// TODO: Remove this function once all calls are updated
	const promises = Array.from(controllerSubscriptions.entries()).map(async ([controllerId, subscriptions]) => {
		await sendStateUpdateForController(controllerId, state)
	})

	await Promise.all(promises)
}
