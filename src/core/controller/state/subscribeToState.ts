import * as vscode from "vscode"
import { Controller } from "../index"
import { EmptyRequest } from "../../../shared/proto/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active state subscriptions by controller ID
const activeStateSubscriptions = new Map<string, StreamingResponseHandler>()

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

	// Send the initial state
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)

	console.log(`[DEBUG] set up state subscription for controller ${controllerId}`)

	await responseStream({
		stateJson: initialStateJson,
	})

	// Add this subscription to the active subscriptions with the controller ID
	activeStateSubscriptions.set(controllerId, responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeStateSubscriptions.delete(controllerId)
		console.log(`[DEBUG] Cleaned up state subscription for controller ${controllerId}`)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}
}

/**
 * Send a state update to a specific controller's subscription
 * @param controllerId The ID of the controller to send the state to
 * @param state The state to send
 */
export async function sendStateUpdate(controllerId: string, state: any): Promise<void> {
	// Get the subscription for this specific controller
	const responseStream = activeStateSubscriptions.get(controllerId)

	if (!responseStream) {
		console.log(`[DEBUG] No active state subscription for controller ${controllerId}`)
		return
	}

	try {
		const stateJson = JSON.stringify(state)
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
		activeStateSubscriptions.delete(controllerId)
	}
}
