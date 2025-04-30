import * as vscode from "vscode"
import { Controller } from "../index"
import { EmptyRequest } from "../../../shared/proto/common"
import { StreamingResponseHandler } from "../grpc-handler"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Set<StreamingResponseHandler>()

/**
 * Subscribe to state updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 */
export async function subscribeToState(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler,
): Promise<void> {
	// Send the initial state
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)

	console.log("[DEBUG] set up state subscription")

	await responseStream({
		stateJson: initialStateJson,
	})

	// Add this subscription to the active subscriptions
	activeStateSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	// We don't actually return this function, but the gRPC handler will call it
	// when the connection is closed
	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	// TODO Store the cleanup function somewhere the gRPC handler can access it
	// This is a workaround since we can't return it directly
	;(responseStream as any).__cleanup = cleanup
}

/**
 * Send a state update to all active subscribers
 * @param state The state to send
 */
export async function sendStateUpdate(state: any): Promise<void> {
	const stateJson = JSON.stringify(state)

	// Send the update to all active subscribers
	const promises = Array.from(activeStateSubscriptions).map(async (responseStream) => {
		try {
			// The issue might be that we're not properly formatting the response
			// Let's ensure we're sending a properly formatted State message
			await responseStream(
				{
					stateJson,
				},
				false, // Not the last message
			)
			console.log("[DEBUG] sending followup state", stateJson.length, "chars")
		} catch (error) {
			console.error("Error sending state update:", error)
			// Remove the subscription if there was an error
			activeStateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
