import { EmptyRequest } from "@shared/proto/cline/common"
import { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from ".."

// Keep track of active HTML preview subscriptions
const activeHtmlPreviewSubscriptions = new Set<StreamingResponseHandler<HtmlPreviewItem>>()

/**
 * Subscribes a client to HTML preview updates.
 * Streams all existing previews immediately, then pushes new previews as they arrive.
 */
export async function subscribeToHtmlPreviews(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<HtmlPreviewItem>,
	requestId?: string,
): Promise<void> {
	console.log("[subscribeToHtmlPreviews] Client subscribed to HTML preview updates", requestId)

	activeHtmlPreviewSubscriptions.add(responseStream)

	// Subscribe to layer updates from controller
	const unsubscribe = controller.subscribeToHtmlPreviewUpdates(async (item: HtmlPreviewItem) => {
		if (activeHtmlPreviewSubscriptions.has(responseStream)) {
			try {
				console.log(`[subscribeToHtmlPreviews] Streaming preview to client: ${item.id}`)
				await responseStream(item, false)
			} catch (error) {
				console.error("[subscribeToHtmlPreviews] Error streaming preview:", error)
				activeHtmlPreviewSubscriptions.delete(responseStream)
				unsubscribe()
			}
		}
	})

	// Register cleanup with the request registry
	const cleanup = () => {
		console.log("[subscribeToHtmlPreviews] Cleaned up preview subscription")
		activeHtmlPreviewSubscriptions.delete(responseStream)
		unsubscribe()
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "html_preview_subscription" }, responseStream)
	}

	// Send all existing previews to the new subscriber
	const existingItems = controller.getHtmlPreviews()
	console.log(`[subscribeToHtmlPreviews] Sending ${existingItems.length} existing previews to subscriber`)

	for (const item of existingItems) {
		try {
			await responseStream(item, false)
		} catch (error) {
			console.error("[subscribeToHtmlPreviews] Error sending existing preview:", error)
			activeHtmlPreviewSubscriptions.delete(responseStream)
			unsubscribe()
			return
		}
	}
}
