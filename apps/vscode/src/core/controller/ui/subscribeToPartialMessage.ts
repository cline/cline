import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineMessage } from "@shared/proto/cline/ui"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to partial message events.
 *
 * Registers the response stream on the Controller (which owns the single WebviewBridge and
 * pushes partial ClineMessage updates directly through it), and registers a cleanup with the
 * gRPC request registry so the stream is cleared when the webview disconnects/cancels. The
 * stream stays open for the lifetime of the connection.
 *
 * @param controller The controller instance
 * @param _request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToPartialMessage(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ClineMessage>,
	requestId?: string,
): Promise<void> {
	// Register this stream with the Controller; it will push partial message updates through it.
	controller.setPartialMessageStream(responseStream)

	// Register cleanup so the Controller drops the stream when the request is cancelled/closed.
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => controller.clearPartialMessageStream(),
			{ type: "partial_message_subscription" },
			responseStream,
		)
	}

	// Keep the stream open — the Controller pushes future updates through it.
}

/**
 * Not used by the SDK-backed Controller: partial messages are pushed directly through the
 * Controller's WebviewBridge. Retained for API compatibility.
 */
export async function sendPartialMessageEvent(_partialMessage: ClineMessage): Promise<void> {
	return
}
