import { StringRequest, Empty } from "@shared/proto/cline/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"
import type { Controller } from "../index"

// Map client IDs to their subscription handlers
const focusChatInputSubscriptions = new Map<string, StreamingResponseHandler<Empty>>()

/**
 * Subscribe to focus chat input events
 * @param controller The controller instance
 * @param request The request containing the client ID
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToFocusChatInput(
	_controller: Controller,
	request: StringRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	const clientId = request.value
	if (!clientId) {
		throw new Error("Client ID is required for focusChatInput subscription")
	}

	// Store this subscription with its client ID
	focusChatInputSubscriptions.set(clientId, responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		focusChatInputSubscriptions.delete(clientId)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "focus_chat_input_subscription" }, responseStream)
	}
}

/**
 * Send a focus chat input event to a specific webview by client ID
 * @param clientId The ID of the client to send the event to
 */
export async function sendFocusChatInputEvent(clientId: string): Promise<void> {
	const responseStream = focusChatInputSubscriptions.get(clientId)
	if (!responseStream) {
		console.warn(`No subscription found for client ID: ${clientId}`)
		return
	}

	try {
		const event = Empty.create({})
		await responseStream(
			event,
			false, // Not the last message
		)
	} catch (error) {
		console.error(`Error sending focus chat input event to client ${clientId}:`, error)
		// Remove the subscription if there was an error
		focusChatInputSubscriptions.delete(clientId)
	}
}
