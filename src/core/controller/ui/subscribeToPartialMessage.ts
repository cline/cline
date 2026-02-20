import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineMessage } from "@shared/proto/cline/ui"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active partial message subscriptions (gRPC streams)
const activePartialMessageSubscriptions = new Set<StreamingResponseHandler<ClineMessage>>()

// Keep track of callback-based subscriptions (for CLI and other non-gRPC consumers)
export type PartialMessageCallback = (message: ClineMessage) => void
const callbackSubscriptions = new Set<PartialMessageCallback>()

const partialMessageStreamSendTimeoutMs = (() => {
	const raw = process.env.CLINE_PARTIAL_MESSAGE_SEND_TIMEOUT_MS
	if (raw === undefined) {
		return 1000
	}
	const parsed = Number.parseInt(raw, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000
})()

const partialMessageSlowSendWarnMs = (() => {
	const raw = process.env.CLINE_PARTIAL_MESSAGE_SLOW_WARN_MS
	if (raw === undefined) {
		return 250
	}
	const parsed = Number.parseInt(raw, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250
})()

/**
 * Subscribe to partial message events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToPartialMessage(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ClineMessage>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activePartialMessageSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activePartialMessageSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "partial_message_subscription" }, responseStream)
	}
}

/**
 * Register a callback to receive partial message events (for CLI and non-gRPC consumers)
 * @param callback The callback function to receive messages
 * @returns A function to unsubscribe
 */
export function registerPartialMessageCallback(callback: PartialMessageCallback): () => void {
	callbackSubscriptions.add(callback)
	return () => {
		callbackSubscriptions.delete(callback)
	}
}

/**
 * Send a partial message event to all active subscribers
 * @param partialMessage The ClineMessage to send
 */
export async function sendPartialMessageEvent(partialMessage: ClineMessage): Promise<void> {
	// Send to gRPC stream subscribers without blocking model stream consumption.
	// A slow or stuck subscriber should not pause chunk polling.
	for (const responseStream of Array.from(activePartialMessageSubscriptions)) {
		const sendStartedAt = Date.now()
		let didTimeout = false
		const timeoutHandle = setTimeout(() => {
			didTimeout = true
			activePartialMessageSubscriptions.delete(responseStream)
			Logger.debug(
				`[PartialMessage] subscriber send timed out after ${partialMessageStreamSendTimeoutMs}ms and was removed`,
			)
		}, partialMessageStreamSendTimeoutMs)

		void responseStream(
			partialMessage,
			false, // Not the last message
		)
			.then(() => {
				const elapsedMs = Date.now() - sendStartedAt
				if (!didTimeout && elapsedMs > partialMessageSlowSendWarnMs) {
					Logger.debug(`[PartialMessage] slow subscriber send elapsedMs=${elapsedMs}`)
				}
			})
			.catch((error) => {
				Logger.error("Error sending partial message event:", error)
				activePartialMessageSubscriptions.delete(responseStream)
			})
			.finally(() => {
				clearTimeout(timeoutHandle)
			})
	}

	// Send to callback subscribers (synchronous)
	for (const callback of callbackSubscriptions) {
		try {
			callback(partialMessage)
		} catch (error) {
			Logger.error("Error in partial message callback:", error)
		}
	}

	return
}
