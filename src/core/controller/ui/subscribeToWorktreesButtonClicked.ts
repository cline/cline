import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active worktrees button clicked subscriptions
const activeWorktreesButtonClickedSubscriptions = new Set<StreamingResponseHandler<Empty>>()

/**
 * Subscribe to worktrees button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToWorktreesButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeWorktreesButtonClickedSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeWorktreesButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			cleanup,
			{ type: "worktrees_button_clicked_subscription" },
			responseStream,
		)
	}
}

/**
 * Send a worktrees button clicked event to all active subscribers
 */
export async function sendWorktreesButtonClickedEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeWorktreesButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending worktrees button clicked event:", error)
			// Remove the subscription if there was an error
			activeWorktreesButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
