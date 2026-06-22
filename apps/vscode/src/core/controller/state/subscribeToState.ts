import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to state updates.
 *
 * Registers the response stream on the Controller (which owns the single WebviewBridge and
 * pushes state snapshots directly), pushes the initial state immediately, and registers a
 * cleanup with the gRPC request registry so the stream is cleared when the webview disconnects.
 * The stream stays open for the lifetime of the connection.
 *
 * @param controller The controller instance
 * @param _request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	// Register this stream with the Controller; it will push partial state updates through it.
	controller.setStateStream(responseStream)

	// Register cleanup so the Controller drops the stream when the request is cancelled/closed.
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => controller.clearStateStream(),
			{ type: "state_subscription" },
			responseStream,
		)
	}

	// Push the initial state snapshot immediately so the webview hydrates on connect.
	try {
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("Error sending initial state:", error)
		controller.clearStateStream()
	}

	// Keep the stream open — the Controller pushes future updates through it.
}

/**
 * Not used by the SDK-backed Controller: state is pushed directly through the Controller's
 * WebviewBridge. Retained for API compatibility.
 */
export async function sendStateUpdate(_state: ExtensionState): Promise<void> {
	return
}
