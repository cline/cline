/**
 * State Subscriber
 *
 * Manages gRPC subscriptions to Controller state updates and
 * partial message events. Tracks which messages have been output
 * and notifies callbacks when new complete messages are available.
 */

import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { State } from "@shared/proto/cline/state"
import type { ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import type { Controller } from "@/core/controller"
import type { StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { subscribeToState } from "@/core/controller/state/subscribeToState"
import { subscribeToPartialMessage } from "@/core/controller/ui/subscribeToPartialMessage"
import type { StateSubscriberConfig } from "./types.js"

/**
 * StateSubscriber class
 *
 * Handles subscription to Controller state updates and tracks
 * which messages have been output to avoid duplicates.
 */
export class StateSubscriber {
	private printedMessageTs = new Set<number>()
	private subscriptionActive = false
	private config: StateSubscriberConfig

	constructor(
		private controller: Controller,
		config: StateSubscriberConfig,
	) {
		this.config = config
	}

	/**
	 * Start listening for state updates
	 */
	start(): void {
		this.subscriptionActive = true

		// Create a streaming response handler for state updates
		const stateResponseHandler: StreamingResponseHandler<State> = async (state: State) => {
			if (!this.subscriptionActive) {
				return
			}

			if (state.stateJson) {
				try {
					const parsedState = JSON.parse(state.stateJson) as ExtensionState
					const messages = parsedState.clineMessages || []
					this.handleStateUpdate(messages)
				} catch {
					// JSON parse error - ignore malformed state
				}
			}
		}

		// Create a streaming response handler for partial message updates
		const partialMessageHandler: StreamingResponseHandler<ProtoClineMessage> = async (protoMessage: ProtoClineMessage) => {
			if (!this.subscriptionActive) {
				return
			}

			// Convert proto message to app message and handle it
			const message = convertProtoToClineMessage(protoMessage)
			this.handleSingleMessage(message)
		}

		// Subscribe to both state updates and partial message events
		subscribeToState(this.controller, EmptyRequest.create(), stateResponseHandler)
		subscribeToPartialMessage(this.controller, EmptyRequest.create(), partialMessageHandler)
	}

	/**
	 * Stop listening for state updates
	 */
	stop(): void {
		this.subscriptionActive = false
	}

	/**
	 * Reset the printed message tracking
	 */
	reset(): void {
		this.printedMessageTs.clear()
	}

	/**
	 * Check if a message has been printed
	 */
	hasBeenPrinted(ts: number): boolean {
		return this.printedMessageTs.has(ts)
	}

	/**
	 * Mark a message as printed
	 */
	markPrinted(ts: number): void {
		this.printedMessageTs.add(ts)
	}

	/**
	 * Handle a state update with new messages
	 *
	 * Messages are only output when they are complete (partial === false).
	 */
	private handleStateUpdate(messages: ClineMessage[]): void {
		// Report activity
		this.config.onActivity?.()

		// Notify callback of all messages
		if (this.config.onStateChange) {
			this.config.onStateChange(messages)
		}

		// Process messages in order, only outputting complete ones we haven't printed yet
		for (const msg of messages) {
			// Skip if already printed
			if (this.printedMessageTs.has(msg.ts)) {
				continue
			}

			// Skip partial messages - wait until they're complete
			if (msg.partial) {
				continue
			}

			// Output the complete message
			this.config.onCompleteMessage(msg)
			this.printedMessageTs.add(msg.ts)
		}
	}

	/**
	 * Handle a single message update from the partial message stream
	 *
	 * This is called when sendPartialMessageEvent is used instead of postStateToWebview.
	 */
	private handleSingleMessage(msg: ClineMessage): void {
		// Report activity
		this.config.onActivity?.()

		// Notify callback with current state (append the new message)
		if (this.config.onStateChange) {
			const currentMessages = this.config.getMessages()
			// Check if this message already exists and update it, or append if new
			const existingIndex = currentMessages.findIndex((m) => m.ts === msg.ts)
			if (existingIndex >= 0) {
				currentMessages[existingIndex] = msg
			} else {
				currentMessages.push(msg)
			}
			this.config.onStateChange(currentMessages)
		}

		// Skip if already printed
		if (this.printedMessageTs.has(msg.ts)) {
			return
		}

		// Skip partial messages - wait until they're complete
		if (msg.partial) {
			return
		}

		// Output the complete message
		this.config.onCompleteMessage(msg)
		this.printedMessageTs.add(msg.ts)
	}
}
