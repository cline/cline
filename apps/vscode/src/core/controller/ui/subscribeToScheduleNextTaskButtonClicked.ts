import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active scheduleNextTaskButtonClicked subscriptions
const activeScheduleNextTaskButtonSubscriptions = new Set<StreamingResponseHandler<Empty>>()

/**
 * Subscribe to "Schedule New Task" clicks — the view-title button the VS Code
 * panel shows beside "New Task", and the same action the standalone navbar
 * offers. The webview answers by opening the schedule composer.
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToScheduleNextTaskButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeScheduleNextTaskButtonSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeScheduleNextTaskButtonSubscriptions.delete(responseStream)
	}

	// Register cleanup function with request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			cleanup,
			{ type: "scheduleNextTaskButtonClicked_subscription" },
			responseStream,
		)
	}
}

/**
 * Send a "Schedule New Task" click event to all active subscribers
 */
export async function sendScheduleNextTaskButtonClickedEvent(): Promise<void> {
	const promises = Array.from(activeScheduleNextTaskButtonSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending scheduleNextTaskButtonClicked event:", error)
			activeScheduleNextTaskButtonSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
