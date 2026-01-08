import { EmptyRequest } from "@shared/proto/cline/common"
import { ShowWebviewEvent } from "@shared/proto/cline/ui"
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
	// Send the event to all active subscribers
	const promises = Array.from(showWebviewSubscriptions).map(async (responseStream) => {
		try {
			const event = ShowWebviewEvent.create({ preserveEditorFocus })
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending show webview event:", error)
			// Remove the subscription if there was an error
			showWebviewSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
