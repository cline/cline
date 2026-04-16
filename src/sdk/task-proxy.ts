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
	/** API handler — settable for model switching via updateSettings */
	api: TaskProxyApi
	/** Browser session — stubbed (browser automation removed in this migration) */
	// biome-ignore lint/suspicious/noExplicitAny: typed as any for handler compatibility; browser automation removed
	browserSession: any
	/** Checkpoint manager — stubbed (shadow git removed in this migration) */
	// biome-ignore lint/suspicious/noExplicitAny: typed as any for handler compatibility; checkpoints removed
	checkpointManager: any
	/** Terminal manager — stub that safely no-ops for settings compatibility */
	terminalManager: TaskProxyTerminalManager
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

	/** Add or update messages from a session event.
	 *  If a message with the same `ts` already exists, update it in-place
	 *  (this handles partial→final streaming updates). Otherwise append.
	 *  This prevents duplicate messages when both partial message stream
	 *  and state updates carry the same content.
	 */
	addMessages(messages: ClineMessage[]): void {
		for (const message of messages) {
			const existingIndex = this.messages.findIndex((m) => m.ts === message.ts)
			if (existingIndex !== -1) {
				// Update existing message in-place (e.g., partial=true → partial=false)
				this.messages[existingIndex] = message
				this.emit("clineMessagesChanged", {
					type: "update",
					messages: this.messages,
					index: existingIndex,
					message,
				})
			} else {
				this.messages.push(message)
				this.emit("clineMessagesChanged", { type: "add", messages: this.messages, message })
			}
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
 * The `api` property is settable — updateSettings() replaces it when the
 * user switches models/providers.
 */
export interface TaskProxyApi {
	getModel: () => { id: string }
}

/**
 * Terminal manager stub for settings compatibility.
 * The updateSettings handler calls setDefaultTerminalProfile() which
 * returns { closedCount, busyTerminals }. This stub safely no-ops.
 */
export interface TaskProxyTerminalManager {
	setDefaultTerminalProfile: (profileId: string) => { closedCount: number; busyTerminals: never[] }
	setShellIntegrationTimeout: (timeout: number) => void
	setTerminalReuseEnabled: (enabled: boolean) => void
	setTerminalOutputLineLimit: (limit: number) => void
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

	// Mutable API handler — updateSettings() replaces it when switching models
	let currentApi: TaskProxyApi = {
		getModel: () => ({ id: "unknown" }),
	}

	// Terminal manager stub — safely no-ops for settings compatibility
	const terminalManagerStub: TaskProxyTerminalManager = {
		setDefaultTerminalProfile: () => ({ closedCount: 0, busyTerminals: [] }),
		setShellIntegrationTimeout: () => {},
		setTerminalReuseEnabled: () => {},
		setTerminalOutputLineLimit: () => {},
	}

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
			return currentApi
		},
		set api(handler: TaskProxyApi) {
			// updateSettings() replaces the API handler when switching models/providers
			currentApi = handler
		},

		get browserSession() {
			// Browser automation removed — see ARCHITECTURE.md
			return undefined
		},

		get checkpointManager() {
			// Shadow git checkpoints removed — see ARCHITECTURE.md
			return undefined
		},

		get terminalManager(): TaskProxyTerminalManager {
			return terminalManagerStub
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
