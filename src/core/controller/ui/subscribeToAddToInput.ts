import type { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

// Keep track of active addToInput subscriptions
const activeAddToInputSubscriptions = new Set<StreamingResponseHandler<ProtoString>>()

// Map client IDs to their subscription handlers for targeted sending
const addToInputSubscriptions = new Map<string, StreamingResponseHandler<ProtoString>>()

/**
 * Subscribe to addToInput events
 * @param controller The controller instance
 * @param request The request containing the client ID
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToAddToInput(
	_controller: Controller,
	request: StringRequest,
	responseStream: StreamingResponseHandler<ProtoString>,
	requestId?: string,
): Promise<void> {
	const clientId = request.value
	if (!clientId) {
		throw new Error("Client ID is required for addToInput subscription")
	}

	console.log("[DEBUG] set up addToInput subscription for client:", clientId)

	// Add this subscription to both the general set and the client-specific map
	activeAddToInputSubscriptions.add(responseStream)
	addToInputSubscriptions.set(clientId, responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeAddToInputSubscriptions.delete(responseStream)
		addToInputSubscriptions.delete(clientId)
		console.log("[DEBUG] Cleaned up addToInput subscription for client:", clientId)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "addToInput_subscription" }, responseStream)
	}
}

/**
 * Send an addToInput event to all active subscribers
 * @param text The text to add to the input
 */
export async function sendAddToInputEvent(text: string): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeAddToInputSubscriptions).map(async (responseStream) => {
		try {
			const event: ProtoString = {
				value: text,
			}
			await responseStream(
				event,
				false, // Not the last message
			)
			console.log("[DEBUG] sending addToInput event", text.length, "chars")
		} catch (error) {
			console.error("Error sending addToInput event:", error)
			// Remove the subscription if there was an error
			activeAddToInputSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

/**
 * Send an addToInput event to a specific webview by client ID
 * @param clientId The ID of the client to send the event to
 * @param text The text to add to the input
 */
export async function sendAddToInputEventToClient(clientId: string, text: string): Promise<void> {
	const responseStream = addToInputSubscriptions.get(clientId)
	if (!responseStream) {
		console.warn(`No addToInput subscription found for client ID: ${clientId}`)
		return
	}

	try {
		const event: ProtoString = {
			value: text,
		}
		await responseStream(
			event,
			false, // Not the last message
		)
		console.log("[DEBUG] sending addToInput event to client", clientId, ":", text.length, "chars")
	} catch (error) {
		console.error(`Error sending addToInput event to client ${clientId}:`, error)
		// Remove the subscription if there was an error
		addToInputSubscriptions.delete(clientId)
		// Also remove from the general set
		activeAddToInputSubscriptions.delete(responseStream)
	}
}
