import * as vscode from "vscode"
import { Controller } from "../index"
import { EmptyRequest } from "../../../shared/proto/common"
import { StreamingResponseHandler } from "../grpc-handler"

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

	await responseStream({
		stateJson: initialStateJson,
	})

	// Since we don't have a built-in event system for state changes,
	// we'll use the postMessageToWebview method as a hook point
	// This will be implemented in the controller class later

	// For now, we'll just send the initial state and keep the connection open
	// The client can always request a new state if needed

	// Note: In a real implementation, we would set up a proper event listener
	// to send updates when the state changes
}
