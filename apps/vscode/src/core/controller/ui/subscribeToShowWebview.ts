import { EmptyRequest } from "@shared/proto/cline/common"
import { ShowWebviewEvent } from "@shared/proto/cline/ui"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

// Keep track of active show webview subscriptions
const showWebviewSubscriptions = new Set<StreamingResponseHandler<ShowWebviewEvent>>()

/**
 * Subscribe to show webview events
 * @param controller The controller instance
 * @param request The show webview request containing preserveEditorFocus flag
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToShowWebview(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ShowWebviewEvent>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	showWebviewSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		showWebviewSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "show_webview_subscription" }, responseStream)
	}
}

/**
 * Send a show webview event to all active subscribers
 * @param preserveEditorFocus When true, the webview should not steal focus from the editor
 */
export async function sendShowWebviewEvent(preserveEditorFocus: boolean = false): Promise<void> {
	// Fire-and-forget: iterate subscribers and send the event. Each subscriber
	// response is handled independently — errors from one subscriber never
	// block others, and we never await all promises. The webview handles events
	// convergently; a dropped event is harmless since the next subscription
	// stream message or full state push carries ground truth.
	for (const responseStream of showWebviewSubscriptions) {
		try {
			const event = ShowWebviewEvent.create({ preserveEditorFocus })
			responseStream(
				event,
				false, // Not the last message
			).catch((error) => {
				Logger.error("Error sending show webview event:", error)
				showWebviewSubscriptions.delete(responseStream)
			})
		} catch (error) {
			Logger.error("Error creating show webview event:", error)
		}
	}
}
