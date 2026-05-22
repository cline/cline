import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"

// Keep track of active HTML preview button clicked subscriptions
const activeHtmlPreviewButtonClickedSubscriptions = new Set<StreamingResponseHandler<Empty>>()

/**
 * Subscribes a client to HTML preview button clicked events.
 * When the button is clicked, the webview should switch to the HTML preview tab.
 */
export async function subscribeToHtmlPreviewButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	console.log(`[DEBUG] set up htmlPreviewButtonClicked subscription`)
	activeHtmlPreviewButtonClickedSubscriptions.add(responseStream)

	const cleanup = () => {
		activeHtmlPreviewButtonClickedSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			cleanup,
			{ type: "htmlPreviewButtonClicked_subscription" },
			responseStream,
		)
	}
}

/**
 * Sends a "button clicked" event to all subscribed clients.
 * Called when the HTML preview panel should be shown.
 */
export async function sendHtmlPreviewButtonClickedEvent(): Promise<void> {
	console.log("[DEBUG] Sending htmlPreviewButtonClicked event to all subscribers")
	const promises = Array.from(activeHtmlPreviewButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(event, false)
		} catch (error) {
			console.error("Error sending htmlPreviewButtonClicked event:", error)
			activeHtmlPreviewButtonClickedSubscriptions.delete(responseStream)
		}
	})
	await Promise.all(promises)
}
