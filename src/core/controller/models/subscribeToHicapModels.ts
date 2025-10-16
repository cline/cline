import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active Hicap models subscriptions
const activeHicapModelsSubscriptions = new Set<StreamingResponseHandler<OpenRouterCompatibleModelInfo>>()

/**
 * Subscribe to Hicap models events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToHicapModels(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<OpenRouterCompatibleModelInfo>,
	requestId?: string,
): Promise<void> {
	console.log("[DEBUG] set up Hicap models subscription")

	// Add this subscription to the active subscriptions
	activeHicapModelsSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeHicapModelsSubscriptions.delete(responseStream)
		console.log("[DEBUG] Cleaned up Hicap models subscription")
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "hicapModels_subscription" }, responseStream)
	}
}

/**
 * Send an Hicap models event to all active subscribers
 * @param models The Hicap models to send
 */
export async function sendHicapModelsEvent(models: OpenRouterCompatibleModelInfo): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeHicapModelsSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				models,
				false, // Not the last message
			)
			console.log("[DEBUG] sending Hicap models event")
		} catch (error) {
			console.error("Error sending Hicap models event:", error)
			// Remove the subscription if there was an error
			activeHicapModelsSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
