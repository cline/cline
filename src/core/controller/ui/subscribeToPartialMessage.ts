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

const PARTIAL_MESSAGE_UPDATE_THROTTLE_MS = 100 // Max 10 updates/second for streaming partial updates
const queuedPartialMessagesByTs = new Map<number, ClineMessage>()
let queuedPartialMessageTimeout: ReturnType<typeof setTimeout> | undefined
let lastPartialMessageDispatchTime = 0
let isFlushingQueuedPartialMessages = false
let activePartialMessageFlush: Promise<void> | undefined

function clearQueuedPartialMessages() {
	queuedPartialMessagesByTs.clear()
	if (queuedPartialMessageTimeout) {
		clearTimeout(queuedPartialMessageTimeout)
		queuedPartialMessageTimeout = undefined
	}
	lastPartialMessageDispatchTime = 0
	isFlushingQueuedPartialMessages = false
	activePartialMessageFlush = undefined
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
		if (activePartialMessageSubscriptions.size === 0) {
			clearQueuedPartialMessages()
		}
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

async function dispatchToStreamSubscribers(partialMessage: ClineMessage): Promise<void> {
	const streamPromises = Array.from(activePartialMessageSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				partialMessage,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending partial message event:", error)
			// Remove the subscription if there was an error
			activePartialMessageSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(streamPromises)
}

function dispatchToCallbackSubscribers(partialMessage: ClineMessage): void {
	for (const callback of callbackSubscriptions) {
		try {
			callback(partialMessage)
		} catch (error) {
			Logger.error("Error in partial message callback:", error)
		}
	}
}

function shouldThrottleMessage(partialMessage: ClineMessage): boolean {
	return partialMessage.partial === true
}

function scheduleQueuedPartialMessageFlush(): void {
	if (queuedPartialMessageTimeout || isFlushingQueuedPartialMessages || activePartialMessageSubscriptions.size === 0) {
		return
	}

	const elapsedSinceLastDispatch = Date.now() - lastPartialMessageDispatchTime
	const delay = Math.max(0, PARTIAL_MESSAGE_UPDATE_THROTTLE_MS - elapsedSinceLastDispatch)

	queuedPartialMessageTimeout = setTimeout(() => {
		queuedPartialMessageTimeout = undefined
		const flushPromise = flushQueuedPartialMessages()
		activePartialMessageFlush = flushPromise
		void flushPromise.finally(() => {
			if (activePartialMessageFlush === flushPromise) {
				activePartialMessageFlush = undefined
			}
		})
	}, delay)
}

async function flushQueuedPartialMessages(): Promise<void> {
	if (isFlushingQueuedPartialMessages || queuedPartialMessagesByTs.size === 0 || activePartialMessageSubscriptions.size === 0) {
		return
	}

	isFlushingQueuedPartialMessages = true
	const queuedMessages = Array.from(queuedPartialMessagesByTs.values())
	queuedPartialMessagesByTs.clear()
	lastPartialMessageDispatchTime = Date.now()

	try {
		for (const queuedMessage of queuedMessages) {
			await dispatchToStreamSubscribers(queuedMessage)
		}
	} finally {
		isFlushingQueuedPartialMessages = false
		if (queuedPartialMessagesByTs.size > 0) {
			scheduleQueuedPartialMessageFlush()
		}
	}
}

/**
 * Send a partial message event to all active subscribers
 * @param partialMessage The ClineMessage to send
 */
export async function sendPartialMessageEvent(partialMessage: ClineMessage): Promise<void> {
	// Callback subscribers are used by CLI/non-gRPC consumers and should remain immediate.
	dispatchToCallbackSubscribers(partialMessage)

	if (activePartialMessageSubscriptions.size === 0) {
		return
	}

	// Throttle streaming partial updates to reduce backpressure in remote webview environments.
	if (shouldThrottleMessage(partialMessage)) {
		queuedPartialMessagesByTs.set(partialMessage.ts, partialMessage)
		scheduleQueuedPartialMessageFlush()
		return
	}

	// Final/non-partial updates bypass throttling to keep completion transitions snappy.
	queuedPartialMessagesByTs.delete(partialMessage.ts)

	// If a queued flush is currently dispatching, wait so final updates are always the latest applied state.
	if (activePartialMessageFlush) {
		await activePartialMessageFlush
	}

	await dispatchToStreamSubscribers(partialMessage)
}
