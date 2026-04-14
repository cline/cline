// Replaces classic src/core/controller/index.ts (see origin/main)
//
// This is the SDK-backed Controller. It provides the same interface as the
// classic Controller but delegates to the Cline SDK (@clinebot/core).
//
// Step 4: Session lifecycle methods (initTask, askResponse, cancelTask, etc.)
// Step 5: gRPC thunking layer — bridges SDK events to webview gRPC streams

import type { CoreSessionEvent } from "@clinebot/core"
import type { ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog } from "@shared/mcp"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import { ensureMcpServersDirectoryExists, ensureSettingsDirectoryExists } from "@/core/storage/disk"
import { StateManager } from "@/core/storage/StateManager"
import { ExtensionRegistryInfo } from "@/registry"
import { McpHub } from "@/services/mcp/McpHub"
import { telemetryService } from "@/services/telemetry"
import { ClineExtensionContext } from "@/shared/cline"
import { Logger } from "@/shared/services/Logger"
import { ClineAccountService } from "./account-service"
import { AuthService, LogoutReason } from "./auth-service"
import {
	type ActiveSession,
	buildSessionConfig,
	buildStartSessionInput,
	createClineCore,
	createHistoryItemFromSession,
	getHistoryItemById,
} from "./cline-session-factory"
import { readUiMessages } from "./legacy-state-reader"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import { WebviewGrpcBridge } from "./webview-grpc-bridge"

/**
 * Log a stub warning and return undefined.
 */
function stubWarn(name: string): void {
	Logger.warn(`[SdkController] STUB: ${name} not yet implemented`)
}

// ---------------------------------------------------------------------------
// Event listener type
// ---------------------------------------------------------------------------

/** Listener for session events translated to ClineMessages */
export type SessionEventListener = (messages: ClineMessage[], event: CoreSessionEvent) => void

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class Controller {
	// SDK session state (Step 4)
	private activeSession: ActiveSession | undefined
	private messageTranslatorState: MessageTranslatorState
	private sessionEventListeners: Set<SessionEventListener> = new Set()

	// gRPC bridge (Step 5) — bridges SDK events to webview streams
	private grpcBridge: WebviewGrpcBridge

	// Task proxy (Step 5) — provides classic Task interface for gRPC handlers
	task?: TaskProxy

	// MCP hub — classic McpHub wired in Step 7; will be replaced by SDK's
	// InMemoryMcpManager in Step 10 (Cleanup)
	mcpHub: McpHub
	// SDK-backed account service (Step 6)
	accountService: ClineAccountService
	// SDK-backed auth service (Step 6)
	authService: AuthService
	// OCA auth uses the same AuthService (Step 6)
	ocaAuthService: AuthService
	readonly stateManager: StateManager

	// Private state kept for stub compatibility
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string

	constructor(readonly context: ClineExtensionContext) {
		// StateManager must be initialized before creating the Controller
		this.stateManager = StateManager.get()

		// MCP hub — using classic McpHub for now (Step 7).
		// Will be replaced by SDK's InMemoryMcpManager in Step 10 (Cleanup).
		this.mcpHub = new McpHub(
			() => ensureMcpServersDirectoryExists(),
			() => ensureSettingsDirectoryExists(),
			ExtensionRegistryInfo.version,
			telemetryService,
		)

		// Initialize SDK-backed auth and account services (Step 6)
		this.authService = AuthService.getInstance(this)
		this.ocaAuthService = this.authService
		this.accountService = ClineAccountService.getInstance()

		// Initialize message translator state
		this.messageTranslatorState = new MessageTranslatorState()

		// Initialize gRPC bridge
		this.grpcBridge = new WebviewGrpcBridge(this.messageTranslatorState)

		// Register the bridge as a session event listener
		this.onSessionEvent(this.grpcBridge.createListener())

		// Restore auth state from secrets on startup
		this.authService.restoreRefreshTokenAndRetrieveAuthInfo().catch((err) => {
			Logger.error("[SdkController] Failed to restore auth state:", err)
		})

		Logger.log("[SdkController] Initialized with SDK adapter layer + gRPC bridge + auth services")
	}

	async dispose(): Promise<void> {
		await this.clearTask()
		this.mcpHub?.dispose?.()
		this.sessionEventListeners.clear()
		Logger.log("[SdkController] Disposed")
	}

	// ---- Session event subscription ----

	/**
	 * Subscribe to session events translated to ClineMessages.
	 * Returns an unsubscribe function.
	 */
	onSessionEvent(listener: SessionEventListener): () => void {
		this.sessionEventListeners.add(listener)
		return () => {
			this.sessionEventListeners.delete(listener)
		}
	}

	/**
	 * Emit translated session events to all listeners.
	 */
	private emitSessionEvents(messages: ClineMessage[], event: CoreSessionEvent): void {
		for (const listener of this.sessionEventListeners) {
			try {
				listener(messages, event)
			} catch (error) {
				Logger.error("[SdkController] Error in session event listener:", error)
			}
		}
	}

	/**
	 * Handle an SDK session event.
	 * Translates the event and emits ClineMessages to listeners.
	 */
	private handleSessionEvent(event: CoreSessionEvent): void {
		const result = translateSessionEvent(event, this.messageTranslatorState)

		if (result.messages.length > 0) {
			this.emitSessionEvents(result.messages, event)

			// Accumulate messages in the task proxy's message state handler
			// so getStateToPostToWebview() can return them
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages(result.messages)
			}
		}

		// Update running state
		if (this.activeSession) {
			if (result.sessionEnded || result.turnComplete) {
				this.activeSession.isRunning = false
			}

			// Update task history with usage info
			if (result.usage && this.activeSession.startResult) {
				this.updateTaskUsage(result.usage)
			}
		}

		// Post state to webview on significant events
		if (result.sessionEnded || result.turnComplete) {
			this.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post state after event:", err)
			})
		}
	}

	/**
	 * Update task usage in history after a turn completes.
	 */
	private updateTaskUsage(usage: { tokensIn: number; tokensOut: number; totalCost?: number }): void {
		// Will be fully wired in Step 5 when gRPC handlers are implemented.
		// For now, just log the usage.
		Logger.log(
			`[SdkController] Task usage: tokensIn=${usage.tokensIn}, tokensOut=${usage.tokensOut}, cost=${usage.totalCost ?? 0}`,
		)
	}

	// ---- Task lifecycle (Step 4) ----

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
	): Promise<string | undefined> {
		try {
			// Clear any existing session first
			await this.clearTask()

			// Build session config from current state
			// ClineExtensionContext doesn't have workspaceRoot — use cwd from
			// the workspace storage or fall back to process.cwd()
			const cwd = process.cwd()
			const modeValue = await this.stateManager.getGlobalSettingsKey("mode")
			const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
			const config = await buildSessionConfig({
				prompt: task,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})

			// Create ClineCore instance
			const core = await createClineCore()

			// Subscribe to session events BEFORE starting
			const unsubscribe = core.subscribe((event: CoreSessionEvent) => {
				this.handleSessionEvent(event)
			})

			// Build start input
			const startInput = buildStartSessionInput(config, {
				prompt: task,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})

			// Start the session
			const startResult = await core.start(startInput)

			// Track the active session
			this.activeSession = {
				sessionId: startResult.sessionId,
				core,
				unsubscribe,
				startResult,
				isRunning: true,
			}

			// Create a task proxy for gRPC handlers
			this.task = createTaskProxy(
				startResult.sessionId,
				// onAskResponse callback
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				// onCancelTask callback
				() => this.cancelTask(),
			)

			// Create a history item for this task (will be saved to task history in Step 6)
			createHistoryItemFromSession(startResult.sessionId, task ?? "", config.modelId, cwd)

			// Emit initial task message
			this.emitSessionEvents(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "task",
						text: task ?? "",
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: startResult.sessionId, status: "running" } },
			)

			// Post state update
			await this.postStateToWebview()

			Logger.log(`[SdkController] Task initialized: ${startResult.sessionId}`)
			return startResult.sessionId
		} catch (error) {
			Logger.error("[SdkController] Failed to init task:", error)
			this.emitSessionEvents(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to start task: ${error instanceof Error ? error.message : String(error)}`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: "", status: "error" } },
			)
			return undefined
		}
	}

	async reinitExistingTaskFromId(taskId: string): Promise<void> {
		try {
			// Clear any existing session
			await this.clearTask()

			// Look up the task in history
			const historyItem = getHistoryItemById(taskId)
			if (!historyItem) {
				Logger.error(`[SdkController] Task not found in history: ${taskId}`)
				return
			}

			// Build session config from the history item's context
			const cwd = historyItem.cwdOnTaskInitialization ?? process.cwd()
			const config = await buildSessionConfig({
				cwd,
				mode: "act", // Default to act mode for resumed tasks
			})

			// Create ClineCore instance
			const core = await createClineCore()

			// Subscribe to events
			const unsubscribe = core.subscribe((event: CoreSessionEvent) => {
				this.handleSessionEvent(event)
			})

			// For resumption, we start a new session with the same config
			// and let the SDK's persistence layer handle loading history.
			// The SDK will use the sessionId to find existing session data.
			const startResult = await core.start({
				config,
				prompt: `[TASK RESUMPTION] Resuming task: ${historyItem.task}`,
				interactive: true,
			})

			this.activeSession = {
				sessionId: startResult.sessionId,
				core,
				unsubscribe,
				startResult,
				isRunning: true,
			}

			// Create a task proxy for gRPC handlers
			this.task = createTaskProxy(
				startResult.sessionId,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)

			await this.postStateToWebview()

			Logger.log(`[SdkController] Task resumed: ${taskId} → ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to reinit task:", error)
			this.emitSessionEvents(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to resume task: ${error instanceof Error ? error.message : String(error)}`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: taskId, status: "error" } },
			)
		}
	}

	async cancelTask(): Promise<void> {
		if (!this.activeSession) {
			Logger.warn("[SdkController] cancelTask: No active session")
			return
		}

		try {
			const { core, sessionId } = this.activeSession
			await core.abort(sessionId)
			this.activeSession.isRunning = false

			// Emit cancellation message
			this.emitSessionEvents(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "info",
						text: "Task cancelled",
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId, status: "cancelled" } },
			)

			await this.postStateToWebview()
			Logger.log(`[SdkController] Task cancelled: ${sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to cancel task:", error)
		}
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	async clearTask(): Promise<void> {
		if (this.activeSession) {
			const { core, unsubscribe, sessionId } = this.activeSession

			// Unsubscribe from events
			unsubscribe()

			// Stop the session (best-effort)
			try {
				await core.stop(sessionId)
			} catch (error) {
				Logger.warn("[SdkController] Error stopping session during clear:", error)
			}

			// Dispose the core instance
			try {
				await core.dispose("clearTask")
			} catch (error) {
				Logger.warn("[SdkController] Error disposing core during clear:", error)
			}

			this.activeSession = undefined
		}

		// Clear the task proxy
		if (this.task) {
			this.task.messageStateHandler.clear()
			this.task = undefined
		}

		// Reset translator state
		this.messageTranslatorState.reset()
	}

	async handleTaskCreation(prompt: string): Promise<void> {
		await this.initTask(prompt)
	}

	/**
	 * Send a follow-up message to the active session.
	 * This is the "askResponse" equivalent — continues the conversation.
	 */
	async askResponse(prompt?: string, images?: string[], files?: string[]): Promise<void> {
		if (!this.activeSession) {
			Logger.error("[SdkController] askResponse: No active session")
			return
		}

		try {
			const { core, sessionId } = this.activeSession
			this.activeSession.isRunning = true

			// Reset translator state for new turn
			this.messageTranslatorState.reset()

			// Send the follow-up message
			await core.send({
				sessionId,
				prompt: prompt ?? "",
				userImages: images,
				userFiles: files,
			})

			await this.postStateToWebview()
			Logger.log(`[SdkController] Message sent to session: ${sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to send message:", error)
			this.emitSessionEvents(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: this.activeSession?.sessionId ?? "", status: "error" } },
			)
		}
	}

	/**
	 * Show a task from history by loading its messages.
	 * This does NOT start inference — it just loads the task for viewing.
	 */
	async showTaskWithId(taskId: string): Promise<void> {
		try {
			const historyItem = getHistoryItemById(taskId)
			if (!historyItem) {
				Logger.error(`[SdkController] Task not found in history: ${taskId}`)
				return
			}

			// Set the current task reference for state building
			this.task = createTaskProxy(
				taskId,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)

			// Load the task's messages from disk and add them to the message state handler
			// so the webview can display them
			const messages = readUiMessages(taskId)
			if (messages.length > 0) {
				this.task.messageStateHandler.addMessages(messages)
				Logger.log(`[SdkController] Loaded ${messages.length} messages for task: ${taskId}`)
			} else {
				Logger.log(`[SdkController] No messages found for task: ${taskId}`)
			}

			await this.postStateToWebview()
			Logger.log(`[SdkController] Showing task: ${taskId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to show task:", error)
		}
	}

	// ---- Mode switching (Step 8) ----

	async toggleActModeForYoloMode(): Promise<boolean> {
		// YOLO mode = auto-approve all tools. Just switch to act mode.
		const currentMode = this.stateManager.getGlobalSettingsKey("mode")
		if (currentMode === "act") {
			return false
		}
		await this.stateManager.setGlobalState("mode", "act")
		await this.postStateToWebview()
		return true
	}

	async togglePlanActMode(modeToSwitchTo: Mode, _chatContent?: ChatContent): Promise<boolean> {
		const currentMode = this.stateManager.getGlobalSettingsKey("mode")
		if (currentMode === modeToSwitchTo) {
			return false
		}

		// Save the mode
		await this.stateManager.setGlobalState("mode", modeToSwitchTo)

		// If there's an active task, we need to handle the mode switch.
		// In the classic controller, this would cancel the current task and
		// potentially start a new one. For now, we just update the mode
		// and let the next task use the new mode's model config.
		if (this.task && this.activeSession?.isRunning) {
			// Cancel the current task — the user will need to send a new message
			// in the new mode. This matches the classic behavior.
			await this.cancelTask()
		}

		await this.postStateToWebview()
		return true
	}

	// ---- Telemetry ----

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		await this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		await this.postStateToWebview()
	}

	// ---- Auth callbacks (Step 6) ----

	async handleSignOut(): Promise<void> {
		await this.authService.handleDeauth(LogoutReason.USER_INITIATED)
		await this.postStateToWebview()
	}

	async handleOcaSignOut(): Promise<void> {
		// OCA uses the same auth service — clear Cline auth on OCA sign out
		await this.authService.handleDeauth(LogoutReason.USER_INITIATED)
		await this.postStateToWebview()
	}

	async setUserInfo(_info?: UserInfo): Promise<void> {
		// User info is now managed by the SDK-backed AuthService
		// This method is kept for interface compatibility
	}

	async handleAuthCallback(customToken: string, provider: string | null = null): Promise<void> {
		await this.authService.handleAuthCallback(customToken, provider ?? "cline")
		await this.postStateToWebview()
	}

	async handleOcaAuthCallback(code: string, state: string): Promise<void> {
		await this.authService.handleOcaAuthCallback(code, state)
		await this.postStateToWebview()
	}

	async handleMcpOAuthCallback(serverHash: string, code: string, state: string | null): Promise<void> {
		await this.authService.handleMcpOAuthCallback(serverHash, code, state)
	}

	// ---- MCP marketplace (Step 7) ----

	async refreshMcpMarketplace(_sendCatalogEvent: boolean): Promise<McpMarketplaceCatalog | undefined> {
		stubWarn("refreshMcpMarketplace")
		return undefined
	}

	// ---- Provider auth callbacks (Step 6) ----

	async handleOpenRouterCallback(_code: string): Promise<void> {
		stubWarn("handleOpenRouterCallback")
	}

	async handleRequestyCallback(_code: string): Promise<void> {
		stubWarn("handleRequestyCallback")
	}

	async handleHicapCallback(_code: string): Promise<void> {
		stubWarn("handleHicapCallback")
	}

	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		stubWarn("readOpenRouterModels")
		return undefined
	}

	// ---- Task history (Step 4) ----

	async getTaskWithId(_id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: unknown[]
	}> {
		stubWarn("getTaskWithId")
		throw new Error("getTaskWithId not yet implemented")
	}

	async exportTaskWithId(_id: string): Promise<void> {
		stubWarn("exportTaskWithId")
	}

	async deleteTaskFromState(_id: string): Promise<HistoryItem[]> {
		stubWarn("deleteTaskFromState")
		return []
	}

	async updateTaskHistory(_item: HistoryItem): Promise<HistoryItem[]> {
		stubWarn("updateTaskHistory")
		return []
	}

	// ---- Background command state ----

	updateBackgroundCommandState(running: boolean, taskId?: string): void {
		this.backgroundCommandRunning = running
		this.backgroundCommandTaskId = taskId
	}

	// ---- State management ----

	async postStateToWebview(): Promise<void> {
		// Import dynamically to avoid circular deps
		const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
		const state = await this.getStateToPostToWebview()
		await sendStateUpdate(state)
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Delegate to the classic implementation which reads from StateManager.
		// This will be gradually replaced with SDK-sourced state in Steps 4-8.
		// For now, we import the classic getStateToPostToWebview logic.
		try {
			const { getStateToPostToWebview: classicGetState } = await import("@core/controller/state/getStateToPostToWebview")
			return await classicGetState({
				task: this.task,
				stateManager: this.stateManager,
				mcpHub: this.mcpHub,
				backgroundCommandRunning: this.backgroundCommandRunning,
				backgroundCommandTaskId: this.backgroundCommandTaskId,
			})
		} catch (error) {
			Logger.error("[SdkController] Failed to get state for webview:", error)
			throw error
		}
	}

	// ---- Workspace (kept from classic) ----

	async ensureWorkspaceManager(): Promise<unknown> {
		stubWarn("ensureWorkspaceManager")
		return undefined
	}
}
