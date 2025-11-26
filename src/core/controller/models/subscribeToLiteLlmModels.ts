import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active LiteLLM models subscriptions
const activeLiteLlmModelsSubscriptions = new Set<StreamingResponseHandler<OpenRouterCompatibleModelInfo>>()

/**
 * Subscribe to LiteLLM models events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToLiteLlmModels(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<OpenRouterCompatibleModelInfo>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeLiteLlmModelsSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeLiteLlmModelsSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "liteLlmModels_subscription" }, responseStream)
	}
}

/**
 * Send a LiteLLM models event to all active subscribers
 * @param models The LiteLLM models to send
 */
export async function sendLiteLlmModelsEvent(models: OpenRouterCompatibleModelInfo): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeLiteLlmModelsSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				models,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending LiteLLM models event:", error)
			// Remove the subscription if there was an error
			activeLiteLlmModelsSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
