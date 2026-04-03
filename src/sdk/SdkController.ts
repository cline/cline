/**
 * SdkController
 *
 * The top-level adapter that wires the SDK session engine with the
 * existing webview protocol. It acts as the GrpcHandlerDelegate and
 * coordinates:
 *
 * - MessageTranslator: SDK events → ClineMessage[]
 * - StateBuilder: builds ExtensionState for webview
 * - GrpcHandler: handles webview gRPC requests
 * - Event bridge: pushes state/message updates to webview
 *
 * This replaces the classic Controller for SDK-powered sessions.
 */

import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

import type { LegacyStateReader } from "./legacy-state-reader"
import { MessageTranslator, type AgentEvent } from "./message-translator"
import { buildExtensionState, type StateBuilderInput } from "./state-builder"
import { GrpcHandler, type GrpcHandlerDelegate } from "./grpc-handler"

// ---------------------------------------------------------------------------
// Session interface — what the SDK session looks like to us
// ---------------------------------------------------------------------------

export interface SdkSession {
	/** Send a prompt to the agent */
	sendPrompt(text: string, images?: string[]): Promise<void>

	/** Send a follow-up/response to a pending ask */
	sendResponse(text: string): Promise<void>

	/** Abort the current session */
	abort(): Promise<void>

	/** Subscribe to events from the session */
	onEvent(handler: (event: AgentEvent) => void): void

	/** Whether the session is currently running */
	isRunning(): boolean
}

/** Factory to create SDK sessions */
export type SessionFactory = (config: {
	apiConfiguration?: ApiConfiguration
	mode?: Mode
	cwd?: string
}) => Promise<SdkSession>

// ---------------------------------------------------------------------------
// SdkController
// ---------------------------------------------------------------------------

export interface SdkControllerOptions {
	/** Function to create new SDK sessions */
	sessionFactory?: SessionFactory

	/** Extension version */
	version?: string

	/** Initial API configuration */
	apiConfiguration?: ApiConfiguration

	/** Initial mode */
	mode?: Mode

	/** Working directory */
	cwd?: string

	/** Task history (from persisted storage) */
	taskHistory?: HistoryItem[]

	/** Legacy state reader (for settings not yet migrated) */
	legacyState?: LegacyStateReader
}

export class SdkController implements GrpcHandlerDelegate {
	private translator: MessageTranslator
	private grpcHandler: GrpcHandler
	private sessionFactory?: SessionFactory
	private currentSession?: SdkSession

	// State
	private version: string
	private apiConfiguration?: ApiConfiguration
	private mode: Mode
	private cwd: string
	private taskHistory: HistoryItem[]
	private currentTaskItem?: HistoryItem
	private isTaskRunning = false
	private legacyState?: LegacyStateReader

	/** External push callbacks (registered by WebviewGrpcBridge) */
	private onPushStateCallback?: (state: ExtensionState) => void
	private onPushPartialMessageCallback?: (message: ClineMessage) => void

	constructor(options: SdkControllerOptions = {}) {
		this.version = options.version ?? "0.0.0"
		this.apiConfiguration = options.apiConfiguration
		this.mode = options.mode ?? "act"
		this.cwd = options.cwd ?? process.cwd()
		this.taskHistory = options.taskHistory ?? []
		this.sessionFactory = options.sessionFactory
		this.legacyState = options.legacyState

		this.translator = new MessageTranslator()
		this.grpcHandler = new GrpcHandler(this)
	}

	/** Get the gRPC handler (for wiring into the webview message system) */
	getGrpcHandler(): GrpcHandler {
		return this.grpcHandler
	}

	/** Get the message translator */
	getTranslator(): MessageTranslator {
		return this.translator
	}

	/** Register a callback for state push events */
	onPushState(callback: (state: ExtensionState) => void): void {
		this.onPushStateCallback = callback
	}

	/** Register a callback for partial message push events */
	onPushPartialMessage(callback: (message: ClineMessage) => void): void {
		this.onPushPartialMessageCallback = callback
	}

	// -----------------------------------------------------------------------
	// GrpcHandlerDelegate implementation
	// -----------------------------------------------------------------------

	getState(): ExtensionState {
		const input: StateBuilderInput = {
			legacyState: this.legacyState,
			version: this.version,
			clineMessages: this.translator.getMessages(),
			currentTaskItem: this.currentTaskItem,
			taskHistory: this.taskHistory,
			mode: this.mode,
			apiConfiguration: this.apiConfiguration,
		}
		return buildExtensionState(input)
	}

	async newTask(text: string, images?: string[]): Promise<void> {
		// Reset translator for new task
		this.translator.reset()
		this.isTaskRunning = true

		// Create task history item
		this.currentTaskItem = {
			id: `task_${Date.now()}`,
			ts: Date.now(),
			task: text,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}

		// Add initial "task" message
		const taskMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "task",
			text,
		}
		this.translator.getMessages().push(taskMessage)

		// Push state update
		this.pushStateUpdate()

		// Create and start session if factory is available
		if (this.sessionFactory) {
			this.currentSession = await this.sessionFactory({
				apiConfiguration: this.apiConfiguration,
				mode: this.mode,
				cwd: this.cwd,
			})

			// Wire up event handler
			this.currentSession.onEvent((event) => this.handleSessionEvent(event))

			// Send prompt
			await this.currentSession.sendPrompt(text, images)
		}
	}

	async askResponse(response: string, text?: string, images?: string[]): Promise<void> {
		// Add user feedback message if there's text
		if (text) {
			const feedbackMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "user_feedback",
				text,
			}
			this.translator.getMessages().push(feedbackMessage)
			this.pushStateUpdate()
		}

		if (this.currentSession) {
			// Send follow-up to the existing session
			const prompt = text || ""
			if (prompt) {
				await this.currentSession.sendResponse(prompt)
			}
		} else if (text && this.sessionFactory) {
			// No active session (e.g., after clearTask) — start a new one
			// This handles the case where the user types a follow-up after
			// the session has been disposed.
			await this.newTask(text, images)
		}
	}

	async clearTask(): Promise<void> {
		if (this.currentSession) {
			await this.currentSession.abort()
		}
		this.currentSession = undefined
		this.isTaskRunning = false
		this.currentTaskItem = undefined
		this.translator.reset()
		this.pushStateUpdate()
	}

	async cancelTask(): Promise<void> {
		if (this.currentSession) {
			await this.currentSession.abort()
		}
		this.isTaskRunning = false

		// Add resume_task ask so the webview shows the input for resuming
		const resumeMsg: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "resume_task",
			text: "",
		}
		this.translator.getMessages().push(resumeMsg)
		this.grpcHandler.pushPartialMessage(resumeMsg)
		this.pushStateUpdate()
	}

	getTaskHistory(offset?: number, limit?: number): HistoryItem[] {
		const start = offset ?? 0
		const end = limit ? start + limit : undefined
		return this.taskHistory.slice(start, end)
	}

	async showTaskWithId(_id: string): Promise<void> {
		// TODO: Load task from history and restore messages
	}

	async deleteTasksWithIds(ids: string[]): Promise<void> {
		if (ids.length === 0) {
			this.taskHistory = []
		} else {
			this.taskHistory = this.taskHistory.filter((item) => !ids.includes(item.id))
		}
		this.pushStateUpdate()
	}

	async updateApiConfiguration(config: Partial<ApiConfiguration>): Promise<void> {
		this.apiConfiguration = { ...this.apiConfiguration, ...config } as ApiConfiguration
		// Persist to disk so settings survive extension restart
		if (this.legacyState) {
			try {
				this.legacyState.saveApiConfiguration(config)
			} catch {
				// Best-effort persistence
			}
		}
		this.pushStateUpdate()
	}

	async togglePlanActMode(mode: Mode): Promise<void> {
		this.mode = mode
		// Persist mode to disk
		if (this.legacyState) {
			try {
				this.legacyState.saveMode(mode)
			} catch {
				// Best-effort persistence
			}
		}
		this.pushStateUpdate()
	}

	async updateSettings(settings: Record<string, unknown>): Promise<void> {
		// Store settings updates (would persist to disk in production)
		this.pushStateUpdate()
	}

	async updateAutoApprovalSettings(settings: Record<string, unknown>): Promise<void> {
		this.pushStateUpdate()
	}

	// -----------------------------------------------------------------------
	// Session event handling
	// -----------------------------------------------------------------------

	/** Process an SDK event and push updates to webview */
	handleSessionEvent(event: AgentEvent): void {
		const update = this.translator.processEvent(event)

		// Push partial message updates for added/modified messages
		const messages = this.translator.getMessages()
		for (const idx of [...update.added, ...update.modified]) {
			if (idx >= 0 && idx < messages.length) {
				const msg = messages[idx]
				this.grpcHandler.pushPartialMessage(msg)
				this.onPushPartialMessageCallback?.(msg)
			}
		}

		// Push full state update if anything changed
		if (update.added.length > 0 || update.modified.length > 0) {
			this.pushStateUpdate()
		}
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private pushStateUpdate(): void {
		const state = this.getState()
		this.grpcHandler.pushState(state)
		this.onPushStateCallback?.(state)
	}
}
