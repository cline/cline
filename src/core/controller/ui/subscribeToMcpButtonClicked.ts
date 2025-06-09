import { Controller } from "../index"
import { Empty } from "@shared/proto/common"
import { WebviewProviderType, WebviewProviderTypeRequest } from "@shared/proto/ui"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Track subscriptions with their provider type
const mcpButtonClickedSubscriptions = new Map<StreamingResponseHandler, WebviewProviderType>()

/**
 * Subscribe to mcpButtonClicked events
 * @param controller The controller instance
 * @param request The webview provider type request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToMcpButtonClicked(
	_controller: Controller,
	request: WebviewProviderTypeRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	const providerType = request.providerType
	console.log(`[DEBUG] set up mcpButtonClicked subscription for ${WebviewProviderType[providerType]} webview`)

	// Store the subscription with its provider type
	mcpButtonClickedSubscriptions.set(responseStream, providerType)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		mcpButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "mcpButtonClicked_subscription" }, responseStream)
	}
}

/**
 * Send a mcpButtonClicked event to active subscribers based on webview type
 * @param webviewType The type of webview that triggered the event (SIDEBAR or TAB)
 */
export async function sendMcpButtonClickedEvent(webviewType?: WebviewProviderType): Promise<void> {
	const event = Empty.create({})

	// Process all subscriptions, filtering based on the source
	const promises = Array.from(mcpButtonClickedSubscriptions.entries()).map(async ([responseStream, providerType]) => {
		// Only send to subscribers of the same type as the event source
		if (webviewType !== providerType) {
			return // Skip subscribers of different types
		}

		try {
			await responseStream(event, false)
		} catch (error) {
			console.error(`Error sending mcpButtonClicked event to ${WebviewProviderType[providerType]}:`, error)
			mcpButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
