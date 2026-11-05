// Replaces classic message streaming from src/core/task/index.ts (see origin/main)
//
// Bridges SDK session events to the webview's gRPC streaming subscriptions.
// When the SDK emits session events (text chunks, tool calls, etc.), this
// module translates them to proto ClineMessages and pushes them through
// the subscribeToState stream the webview listens on.

import type { CoreSessionEvent } from "@cline/core"
import { sendStateUpdate } from "@core/controller/state/subscribeToState"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"
import { convertClineMessageToProto } from "@shared/proto-conversions/cline-message"
import { Logger } from "@shared/services/Logger"
import type { MessageTranslatorState } from "./message-translator"
import type { SessionEventListener } from "./sdk-message-coordinator"

/**
 * Manages the bridge between SDK session events and webview gRPC streams.
 *
 * When the SDK emits events, this bridge:
 * 1. Translates them to ClineMessage[] via the message translator
 * 2. Converts each ClineMessage to proto format
 * 3. Pushes state updates through the subscribeToState gRPC stream
 *    on significant events (turn complete, session ended)
 *
 * The bridge needs access to the controller's getStateToPostToWebview()
 * method to push state updates that include the current task's messages
 * and task history. Without this, state updates would have empty messages.
 */
export class WebviewGrpcBridge {
	/** Function to get the full ExtensionState from the controller */
	private getStateFn?: () => Promise<import("@shared/ExtensionMessage").ExtensionState>

	/**
	 * Set the function used to get ExtensionState for state updates.
	 * This should be called after the controller is fully initialized,
	 * passing `controller.getStateToPostToWebview.bind(controller)`.
	 */
	setGetStateFn(fn: () => Promise<import("@shared/ExtensionMessage").ExtensionState>): void {
		this.getStateFn = fn
	}

	/**
	 * Create a SessionEventListener that bridges events to the webview.
	 * This is passed to SdkController.onSessionEvent().
	 */
	createListener(): SessionEventListener {
		return (messages: ClineMessage[], event: CoreSessionEvent) => {
			this.handleSessionEvent(messages, event)
		}
	}

	/**
	 * Handle a session event by pushing translated messages to webview streams.
	 *
	 * NOTE: The messages are already translated by SdkController.handleSessionEvent().
	 * We do NOT re-translate here — that would double-emit messages and corrupt
	 * the MessageTranslatorState (e.g., state.reset() on iteration_start would
	 * clear streaming timestamps that the first translation used).
	 */
	private handleSessionEvent(messages: ClineMessage[], event: CoreSessionEvent): void {
		// Check if we need to push a state update based on event type.
		// Do NOT call translateSessionEvent() again — the messages are already
		// translated. Just check the raw event type for state update triggers.
		const needsStateUpdate =
			event.type === "ended" ||
			(event.type === "agent_event" && (event.payload.event.type === "done" || event.payload.event.type === "error"))

		if (needsStateUpdate) {
			// Push state update asynchronously — don't block the event stream
			this.pushStateUpdate().catch((err) => {
				Logger.error("[WebviewGrpcBridge] Failed to push state update:", err)
			})
		}
	}

	/**
	 * Push a state update to the webview via the subscribeToState stream.
	 * This is called on significant events (turn complete, session ended).
	 *
	 * Uses the controller's getStateToPostToWebview() when available,
	 * which includes the current task's messages and task history.
	 * Falls back to a minimal state update without task data.
	 */
	private async pushStateUpdate(): Promise<void> {
		try {
			if (this.getStateFn) {
				// Use the controller's getStateToPostToWebview() which
				// includes messages, currentTaskItem, and task history
				const state = await this.getStateFn()
				await sendStateUpdate(state)
			} else {
				// Fallback: build a minimal state without task data
				const { getStateToPostToWebview } = await import("@core/controller/state/getStateToPostToWebview")
				const { StateManager } = await import("@core/storage/StateManager")
				const stateManager = StateManager.get()
				const state = await getStateToPostToWebview({
					task: undefined,
					stateManager,
					mcpHub: undefined,
					backgroundCommandRunning: false,
					foregroundCommandRunning: false,
					backgroundCommandTaskId: undefined,
				})
				await sendStateUpdate(state)
			}
		} catch (error) {
			Logger.error("[WebviewGrpcBridge] Failed to push state update:", error)
		}
	}

	/**
	 * Push a state update using the controller's getStateToPostToWebview method.
	 * This is the preferred way when the controller is available.
	 */
	async pushStateUpdateFromController(getState: () => Promise<ExtensionState>): Promise<void> {
		try {
			const state = await getState()
			await sendStateUpdate(state)
		} catch (error) {
			Logger.error("[WebviewGrpcBridge] Failed to push state update from controller:", error)
		}
	}
}

/**
 * Standalone function to push a ClineMessage to the webview.
 * Useful for one-off messages outside the bridge's event loop.
 */
export async function pushMessageToWebview(message: ClineMessage): Promise<void> {
	console.warn('DEFUNCT pushMessageToWebview')
	return Promise.resolve()
}
