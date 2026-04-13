// Replaces classic src/core/task/index.ts task object (see origin/main)
//
// When handlers call controller.task.handleWebviewAskResponse(), controller.task.ulid,
// controller.task.abortTask(), etc., this proxy delegates to the SdkController's
// session methods. This allows existing gRPC handlers to work without modification.
//
// Not all classic Task methods are implemented here — only those called by
// the gRPC handler modules in src/core/controller/. Missing methods log a warning
// and return safe defaults.

import { EventEmitter } from "node:events"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import type { ClineAskResponse } from "@shared/WebviewMessage"

/**
 * Interface for the task proxy — mirrors the subset of classic Task
 * properties and methods that gRPC handlers actually call.
 */
export interface TaskProxy {
	/** Session ID (maps to classic task's ulid/taskId) */
	ulid: string
	taskId: string
	/** Delegate ask response to the controller's session */
	handleWebviewAskResponse: (askResponse: ClineAskResponse, text?: string, images?: string[], files?: string[]) => Promise<void>
	/** Abort the running task */
	abortTask: () => Promise<void>
	/** API handler — stubbed for now, needed for model switching */
	api: TaskProxyApi
	/** Browser session — stubbed (browser automation removed in this migration) */
	// biome-ignore lint/suspicious/noExplicitAny: typed as any for handler compatibility; browser automation removed
	browserSession: any
	/** Checkpoint manager — stubbed (shadow git removed in this migration) */
	// biome-ignore lint/suspicious/noExplicitAny: typed as any for handler compatibility; checkpoints removed
	checkpointManager: any
	/** Terminal manager — stubbed for now, will be wired in Step 8 */
	// biome-ignore lint/suspicious/noExplicitAny: typed as any for handler compatibility; will be properly typed in Step 8
	terminalManager: any
	/** Task state for tracking */
	taskState: TaskProxyState
	/** Message state handler — accumulates messages for state building */
	messageStateHandler: MessageStateHandler
}

/**
 * Event map for MessageStateHandler.
 * Mirrors the classic MessageStateHandlerEvents from src/core/task/message-state.ts.
 * Uses tuple syntax for EventEmitter compatibility.
 */
export interface MessageStateHandlerEvents {
	clineMessagesChanged: [change: ClineMessageChange]
}

/**
 * Change event for message updates.
 * Mirrors ClineMessageChange from src/core/task/message-state.ts.
 */
export interface ClineMessageChange {
	type: "add" | "update" | "set" | "delete"
	/** The full array after the change */
	messages: ClineMessage[]
	/** The affected index (for add/update/delete) */
	index?: number
	/** The new/updated message (for add/update) */
	message?: ClineMessage
}

/**
 * Message state handler that accumulates ClineMessages and emits change events.
 * Extends EventEmitter for compatibility with the classic MessageStateHandler
 * used by the CLI's ClineAgent (on/off event subscription pattern).
 *
 * The classic Task had a full MessageStateHandler; this provides the
 * getClineMessages() and event emitter interface that consumers expect.
 */
export class MessageStateHandler extends EventEmitter<MessageStateHandlerEvents> {
	private messages: ClineMessage[] = []

	/** Add messages from a session event */
	addMessages(messages: ClineMessage[]): void {
		for (const message of messages) {
			this.messages.push(message)
			this.emit("clineMessagesChanged", { type: "add", messages: this.messages, message })
		}
	}

	/** Get all accumulated messages (returns a copy) */
	getClineMessages(): ClineMessage[] {
		return [...this.messages]
	}

	/** Clear all messages (e.g., on task clear) */
	clear(): void {
		this.messages = []
	}
}

/**
 * Minimal API handler interface for model info access.
 * The classic Task had a full API handler; we expose just what handlers need.
 */
export interface TaskProxyApi {
	getModel: () => { id: string }
}

/**
 * Task state tracking — mirrors the subset of classic TaskState
 * that handlers reference.
 */
export interface TaskProxyState {
	askResponse?: ClineAskResponse
	autoRetryAttempts?: number
	/** Checkpoint manager initialized flag (stub — checkpoints removed) */
	isInitialized?: boolean
	/** Checkpoint manager error message (stub — checkpoints removed) */
	checkpointManagerErrorMessage?: string
	/** Focus chain checklist (stub — focus chain removed) */
	currentFocusChainChecklist?: null
	/** Abort flag for task cancellation (classic TaskState used boolean) */
	abort?: boolean
}

/**
 * Callback type for delegating ask responses to the controller.
 */
export type AskResponseCallback = (text?: string, images?: string[], files?: string[]) => Promise<void>

/**
 * Callback type for delegating task cancellation to the controller.
 */
export type CancelTaskCallback = () => Promise<void>

/**
 * Create a task proxy that delegates to the SdkController.
 *
 * @param sessionId The SDK session ID
 * @param onAskResponse Callback to send a response to the active session
 * @param onCancelTask Callback to cancel the active session
 * @returns A TaskProxy object
 */
export function createTaskProxy(
	sessionId: string,
	onAskResponse: AskResponseCallback,
	onCancelTask: CancelTaskCallback,
): TaskProxy {
	const state: TaskProxyState = {}
	const messageStateHandler = new MessageStateHandler()

	const proxy: TaskProxy = {
		get ulid(): string {
			return sessionId
		},

		get taskId(): string {
			return sessionId
		},

		async handleWebviewAskResponse(
			askResponse: ClineAskResponse,
			text?: string,
			images?: string[],
			files?: string[],
		): Promise<void> {
			// Store the response type in task state (some handlers check this)
			state.askResponse = askResponse

			switch (askResponse) {
				case "yesButtonClicked":
				case "noButtonClicked":
					// For approval responses, we just send an empty continuation
					// The SDK handles approval differently than the classic Task
					await onAskResponse(text, images, files)
					break

				case "messageResponse":
					// User sent a follow-up message
					await onAskResponse(text, images, files)
					break

				default:
					Logger.warn(`[TaskProxy] Unhandled askResponse type: ${askResponse}`)
					await onAskResponse(text, images, files)
					break
			}
		},

		async abortTask(): Promise<void> {
			await onCancelTask()
		},

		get api(): TaskProxyApi {
			// Stub API handler — provides minimal model info
			// Full API handler replacement happens in later steps
			return {
				getModel: () => ({
					id: "unknown",
				}),
			}
		},

		get browserSession() {
			// Browser automation removed — see ARCHITECTURE.md
			return undefined
		},

		get checkpointManager() {
			// Shadow git checkpoints removed — see ARCHITECTURE.md
			return undefined
		},

		get terminalManager() {
			// Terminal management will be wired in Step 8
			return undefined
		},

		get taskState(): TaskProxyState {
			return state
		},

		get messageStateHandler(): MessageStateHandler {
			return messageStateHandler
		},
	}

	return proxy
}
