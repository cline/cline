import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineMessage, ClineSay } from "@shared/proto/cline/ui"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active partial message subscriptions (gRPC streams)
const activePartialMessageSubscriptions = new Set<StreamingResponseHandler<ClineMessage>>()

// Keep track of callback-based subscriptions (for CLI and other non-gRPC consumers)
export type PartialMessageCallback = (message: ClineMessage) => void
const callbackSubscriptions = new Set<PartialMessageCallback>()

// Throttle state for debouncing partial message updates
let lastPartialSendTime = 0
let pendingPartialMessage: ClineMessage | null = null
let throttleTimer: NodeJS.Timeout | null = null

const THROTTLE_DELAY_MS = 50 // Max 20 updates/second (prevents excessive React re-renders)
const THROTTLE_DELAY_MS_REASONING = 80 // Reasoning can be throttled a bit more

/**
 * Reset the partial message throttle state.
 * CRITICAL: Must be called when a task is aborted/cancelled to prevent
 * throttle state from the previous task delaying messages in a new task.
 */
export function resetPartialMessageThrottle(): void {
	if (throttleTimer) {
		clearTimeout(throttleTimer)
		throttleTimer = null
	}
	pendingPartialMessage = null
	lastPartialSendTime = 0
}

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
 * Send a partial message event to all active subscribers with throttling
 * @param partialMessage The ClineMessage to send
 */
export async function sendPartialMessageEvent(partialMessage: ClineMessage): Promise<void> {
	const isPartial = partialMessage.partial === true
	const isReasoning = partialMessage.say === ClineSay.REASONING
	const throttleDelayMs = isReasoning ? THROTTLE_DELAY_MS_REASONING : THROTTLE_DELAY_MS

	// Complete messages always go through immediately
	if (!isPartial) {
		// Cancel any pending throttled update since this is the final state
		if (throttleTimer) {
			clearTimeout(throttleTimer)
			throttleTimer = null
			pendingPartialMessage = null
		}
		await sendToSubscribers(partialMessage)
		return
	}

	// For partial messages, use throttling
	const now = Date.now()
	const timeSinceLastSend = now - lastPartialSendTime

	if (timeSinceLastSend >= throttleDelayMs) {
		// Enough time has passed, send immediately
		lastPartialSendTime = now
		await sendToSubscribers(partialMessage)
		pendingPartialMessage = null
	} else {
		// Too soon, store this update and schedule it
		pendingPartialMessage = partialMessage

		// If no timer is set, schedule one
		if (!throttleTimer) {
			const delay = throttleDelayMs - timeSinceLastSend
			throttleTimer = setTimeout(async () => {
				// Snapshot+clear pending BEFORE the await to prevent a newer
				// partial arriving during sendToSubscribers from being wiped
				// when we null-out pendingPartialMessage after the await.
				const messageToSend = pendingPartialMessage
				pendingPartialMessage = null
				if (messageToSend) {
					lastPartialSendTime = Date.now()
					await sendToSubscribers(messageToSend)
				}
				throttleTimer = null
				// If a newer partial arrived while we were sending, re-schedule
				if (pendingPartialMessage) {
					// Kick off another send cycle immediately (enough time has passed)
					lastPartialSendTime = Date.now()
					const next = pendingPartialMessage
					pendingPartialMessage = null
					sendToSubscribers(next).catch((e) => Logger.error("Error in re-scheduled partial send:", e))
				}
			}, delay)
		}
		// If timer already exists, the latest pendingPartialMessage will be sent when it fires
	}
}

/**
 * Internal helper to send message to all subscribers
 */
async function sendToSubscribers(message: ClineMessage): Promise<void> {
	// Send to gRPC stream subscribers
	const streamPromises = Array.from(activePartialMessageSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				message,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending partial message event:", error)
			// Remove the subscription if there was an error
			activePartialMessageSubscriptions.delete(responseStream)
		}
	})

	// Send to callback subscribers (synchronous)
	for (const callback of callbackSubscriptions) {
		try {
			callback(message)
		} catch (error) {
			Logger.error("Error in partial message callback:", error)
		}
	}

	await Promise.all(streamPromises)
}
