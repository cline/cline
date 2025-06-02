import { Controller } from "../index"
import { Empty } from "@shared/proto/common"
import { WebviewProviderType, WebviewProviderTypeRequest } from "@shared/proto/ui"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active subscriptions with their provider type
const activeHistoryButtonClickedSubscriptions = new Map<StreamingResponseHandler, WebviewProviderType>()

/**
 * Subscribe to history button clicked events
 * @param controller The controller instance
 * @param request The webview provider type request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToHistoryButtonClicked(
	controller: Controller,
	request: WebviewProviderTypeRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	// Extract the provider type from the request
	const providerType = request.providerType
	console.log(`[DEBUG] set up history button subscription for ${WebviewProviderType[providerType]} webview`)

	// Add this subscription to the active subscriptions with its provider type
	activeHistoryButtonClickedSubscriptions.set(responseStream, providerType)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeHistoryButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "history_button_clicked_subscription" }, responseStream)
	}
}

/**
 * Send a history button clicked event to all active subscribers
 * @param webviewType Optional filter to send only to a specific webview type
 */
export async function sendHistoryButtonClickedEvent(webviewType?: WebviewProviderType): Promise<void> {
	// Send the event to all active subscribers matching the webview type (if specified)
	const promises = Array.from(activeHistoryButtonClickedSubscriptions.entries()).map(async ([responseStream, providerType]) => {
		// Skip subscribers of different types if webview type is specified
		if (webviewType !== undefined && webviewType !== providerType) {
			return
		}

		try {
			const event: Empty = {}
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error(`Error sending history button clicked event to ${WebviewProviderType[providerType]}:`, error)
			// Remove the subscription if there was an error
			activeHistoryButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
