import { Controller } from "../index"
import { EmptyRequest, StringArray } from "@shared/proto/cline/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"

// Keep track of active subscriptions
const activeWorkspaceUpdateSubscriptions = new Set<StreamingResponseHandler<StringArray>>()

/**
 * Subscribe to workspace file updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToWorkspaceUpdates(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<StringArray>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeWorkspaceUpdateSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeWorkspaceUpdateSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "workspace_update_subscription" }, responseStream)
	}
}

/**
 * Send a workspace update event to all active subscribers
 * @param filePaths Array of file paths to send
 */
export async function sendWorkspaceUpdateEvent(filePaths: string[]): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeWorkspaceUpdateSubscriptions).map(async (responseStream) => {
		try {
			const event = StringArray.create({
				values: filePaths,
			})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending workspace update event:", error)
			// Remove the subscription if there was an error
			activeWorkspaceUpdateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
