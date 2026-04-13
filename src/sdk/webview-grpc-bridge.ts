// Replaces classic message streaming from src/core/task/index.ts (see origin/main)
//
// Bridges SDK session events to the webview's gRPC streaming subscriptions.
// When the SDK emits session events (text chunks, tool calls, etc.), this
// module translates them to proto ClineMessages and pushes them through
// the existing subscribeToPartialMessage and subscribeToState streams.
//
// This is the "thunking layer" — the webview continues to receive gRPC-shaped
// messages, but the source is now the SDK instead of the classic Task.

import type { CoreSessionEvent } from "@clinebot/core"
import { sendStateUpdate } from "@core/controller/state/subscribeToState"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"
import { convertClineMessageToProto } from "@shared/proto-conversions/cline-message"
import { Logger } from "@shared/services/Logger"
import type { MessageTranslatorState } from "./message-translator"
import { translateSessionEvent } from "./message-translator"
import type { SessionEventListener } from "./SdkController"

/**
 * Manages the bridge between SDK session events and webview gRPC streams.
 *
 * When the SDK emits events, this bridge:
 * 1. Translates them to ClineMessage[] via the message translator
 * 2. Converts each ClineMessage to proto format
 * 3. Pushes them through the subscribeToPartialMessage gRPC stream
 * 4. Pushes state updates through the subscribeToState gRPC stream
 *    on significant events (turn complete, session ended)
 */
export class WebviewGrpcBridge {
	private translatorState: MessageTranslatorState

	constructor(translatorState: MessageTranslatorState) {
		this.translatorState = translatorState
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
	 * Handle a session event by translating and pushing to webview streams.
	 */
	private handleSessionEvent(messages: ClineMessage[], event: CoreSessionEvent): void {
		// Push each translated message through the partial message stream
		for (const message of messages) {
			this.pushPartialMessage(message)
		}

		// Check if we need to push a state update
		const result = translateSessionEvent(event, this.translatorState)
		if (result.sessionEnded || result.turnComplete) {
			// Push state update asynchronously — don't block the event stream
			this.pushStateUpdate().catch((err) => {
				Logger.error("[WebviewGrpcBridge] Failed to push state update:", err)
			})
		}
	}

	/**
	 * Push a ClineMessage to the webview via the subscribeToPartialMessage stream.
	 */
	private async pushPartialMessage(message: ClineMessage): Promise<void> {
		try {
			const protoMessage: ProtoClineMessage = convertClineMessageToProto(message)
			await sendPartialMessageEvent(protoMessage)
		} catch (error) {
			Logger.error("[WebviewGrpcBridge] Failed to push partial message:", error)
		}
	}

	/**
	 * Push a state update to the webview via the subscribeToState stream.
	 * This is called on significant events (turn complete, session ended).
	 */
	private async pushStateUpdate(): Promise<void> {
		try {
			// Import dynamically to avoid circular deps
			const { getStateToPostToWebview } = await import("@core/controller/state/getStateToPostToWebview")
			const { StateManager } = await import("@core/storage/StateManager")
			const stateManager = StateManager.get()
			const state = await getStateToPostToWebview({
				task: undefined, // Will be populated by the controller
				stateManager,
				mcpHub: undefined,
				backgroundCommandRunning: false,
				backgroundCommandTaskId: undefined,
			})
			await sendStateUpdate(state)
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
	try {
		const protoMessage: ProtoClineMessage = convertClineMessageToProto(message)
		await sendPartialMessageEvent(protoMessage)
	} catch (error) {
		Logger.error("[WebviewGrpcBridge] Failed to push message to webview:", error)
	}
}
