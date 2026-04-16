// Replaces classic src/core/controller/index.ts (see origin/main)
//
// This is the SDK-backed Controller. It provides the same interface as the
// classic Controller but delegates to the Cline SDK (@clinebot/core).
//
// Step 4: Session lifecycle methods (initTask, askResponse, cancelTask, etc.)
// Step 5: gRPC thunking layer — bridges SDK events to webview gRPC streams

import * as fs from "node:fs/promises"
import * as path from "node:path"
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
import { ensureMcpServersDirectoryExists, ensureSettingsDirectoryExists, GlobalFileNames } from "@/core/storage/disk"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { McpHub } from "@/services/mcp/McpHub"
import { telemetryService } from "@/services/telemetry"
import { ClineExtensionContext } from "@/shared/cline"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "@/utils/fs"
import { ClineAccountService } from "./account-service"
import { AuthService, LogoutReason } from "./auth-service"
import {
	type ActiveSession,
	buildSessionConfig,
	buildStartSessionInput,
	createHistoryItemFromSession,
	getHistoryItemById,
} from "./cline-session-factory"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import { VscodeSessionHost } from "./vscode-session-host"
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

	// Debounce timer for saving ClineMessages to disk
	private saveClineMessagesTimer: ReturnType<typeof setTimeout> | undefined

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

		// Wire the bridge to the controller's getStateToPostToWebview()
		// so state updates include messages, currentTaskItem, and task history
		this.grpcBridge.setGetStateFn(() => this.getStateToPostToWebview())

		// Register the bridge as a session event listener
		this.onSessionEvent(this.grpcBridge.createListener())

		// Restore auth state from secrets on startup
		this.authService.restoreRefreshTokenAndRetrieveAuthInfo().catch((err) => {
			Logger.error("[SdkController] Failed to restore auth state:", err)
		})

		Logger.log("[SdkController] Initialized with SDK adapter layer + gRPC bridge + auth services")
	}

	async dispose(): Promise<void> {
		// Flush any pending message save
		if (this.saveClineMessagesTimer) {
			clearTimeout(this.saveClineMessagesTimer)
			this.saveClineMessagesTimer = undefined
		}
		await this.clearTask()
		this.mcpHub?.dispose?.()
		this.sessionEventListeners.clear()
		Logger.log("[SdkController] Disposed")
	}

	// ---- Message persistence ----

	/**
	 * Debounced save of ClineMessages to disk.
	 * Writes to the classic ui_messages.json location so that
	 * showTaskWithId() → getSavedClineMessages() can find them later.
	 */
	private debouncedSaveClineMessages(): void {
		if (this.saveClineMessagesTimer) {
			clearTimeout(this.saveClineMessagesTimer)
		}
		this.saveClineMessagesTimer = setTimeout(() => {
			this.saveClineMessagesTimer = undefined
			this.saveClineMessagesNow().catch((err) => {
				Logger.error("[SdkController] Failed to save ClineMessages:", err)
			})
		}, 500) // 500ms debounce — fast enough for interruptions, slow enough to batch
	}

	private async saveClineMessagesNow(): Promise<void> {
		const taskId = this.task?.taskId
		if (!taskId || !this.task?.messageStateHandler) {
			return
		}
		const messages = this.task.messageStateHandler.getClineMessages()
		if (messages.length === 0) {
			return
		}
		try {
			const { saveClineMessages } = await import("@core/storage/disk")
			await saveClineMessages(taskId, messages)
		} catch (error) {
			Logger.error("[SdkController] saveClineMessagesNow error:", error)
		}
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
			// Accumulate messages in the task proxy's message state handler
			// BEFORE emitting to listeners. This ensures that if a listener
			// (e.g., the gRPC bridge) triggers a state update, the state
			// will include these messages.
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages(result.messages)

				// Persist messages to disk so showTaskWithId() can load them later.
				this.debouncedSaveClineMessages()
			}

			// Emit to listeners (bridge pushes via partial message stream)
			this.emitSessionEvents(result.messages, event)
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

		// Push state update so the webview's clineMessages stays in sync.
		// The partial message stream pushes individual messages, but the
		// webview also needs the full clineMessages array in state for
		// proper rendering (e.g., ChatView checks messages.length).
		if (result.messages.length > 0) {
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
		Logger.log(`[SdkController] initTask called: "${task?.substring(0, 50)}"`)
		try {
			// Clear any existing session first
			await this.clearTask()

			// Build session config from current state
			const cwd = process.cwd()
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
			Logger.log(`[SdkController] Building session config: mode=${mode}, cwd=${cwd}`)
			const config = await buildSessionConfig({
				prompt: task,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})
			Logger.log(
				`[SdkController] Session config: provider=${config.providerId}, model=${config.modelId}, hasApiKey=${!!config.apiKey}`,
			)

			// Create VscodeSessionHost instance (wraps DefaultSessionManager
			// with VscodeRuntimeBuilder + VscodeOAuthTokenManager)
			Logger.log("[SdkController] Creating VscodeSessionHost...")
			const sessionManager = await VscodeSessionHost.create({ mcpHub: this.mcpHub })

			// Subscribe to session events BEFORE starting
			const unsubscribe = sessionManager.subscribe((event: CoreSessionEvent) => {
				this.handleSessionEvent(event)
			})

			// Build start input — NO prompt, so start() returns immediately
			// (session creation only, no inference yet)
			const startInput = buildStartSessionInput(config, {
				prompt: task,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})

			// Start the session (returns immediately since no prompt)
			Logger.log("[SdkController] Starting session (no prompt — fast return)...")
			const startResult = await sessionManager.start(startInput)

			// Track the active session
			this.activeSession = {
				sessionId: startResult.sessionId,
				sessionManager,
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

			// Create and save a history item for this task
			const newHistoryItem = createHistoryItemFromSession(startResult.sessionId, task ?? "", config.modelId, cwd)
			await this.updateTaskHistory(newHistoryItem)

			// Emit initial task message — must be added to messageStateHandler
			// so that getStateToPostToWebview() includes it in clineMessages.
			// Without this, the state update would have empty clineMessages and
			// the webview would lose the task message (S6-22 fix).
			const taskMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "task",
				text: task ?? "",
				partial: false,
			}
			// Add to message state handler FIRST so state includes it
			this.task.messageStateHandler.addMessages([taskMessage])
			// Then emit to listeners (bridge pushes via partial message stream)
			this.emitSessionEvents([taskMessage], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: "running" },
			})

			// Post state update — now includes the task message in clineMessages
			await this.postStateToWebview()

			// Now send the prompt to start inference (fire-and-forget).
			// sessionManager.send() blocks until the agent turn completes, but events
			// stream in real-time via the subscription we set up above.
			// We do NOT await this — the gRPC handler needs to return immediately.
			if (task?.trim()) {
				Logger.log(`[SdkController] Sending prompt to session: ${startResult.sessionId}`)
				Logger.log(
					`[SdkController] Config: provider=${config.providerId}, model=${config.modelId}, hasApiKey=${!!config.apiKey}, apiKeyPrefix=${config.apiKey?.substring(0, 15)}`,
				)
				const sendStartTime = Date.now()
				sessionManager
					.send({
						sessionId: startResult.sessionId,
						prompt: task,
						userImages: images,
						userFiles: files,
					})
					.then((result) => {
						Logger.log(
							`[SdkController] Agent turn completed for session: ${startResult.sessionId}, result=${JSON.stringify(result)?.substring(0, 200)}`,
						)
						if (this.activeSession) {
							this.activeSession.isRunning = false
						}
						this.postStateToWebview().catch((err) => {
							Logger.error("[SdkController] Failed to post state after turn:", err)
						})
					})
					.catch((error) => {
						Logger.error("[SdkController] Agent turn failed:", error)
						this.emitSessionEvents(
							[
								{
									ts: Date.now(),
									type: "say",
									say: "error",
									text: `Agent error: ${error instanceof Error ? error.message : String(error)}`,
									partial: false,
								},
							],
							{ type: "status", payload: { sessionId: startResult.sessionId, status: "error" } },
						)
						if (this.activeSession) {
							this.activeSession.isRunning = false
						}
						this.postStateToWebview().catch(() => {})
					})
			}

			Logger.log(`[SdkController] Task initialized: ${startResult.sessionId}`)
			return startResult.sessionId
		} catch (error) {
			const errorDetails =
				error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.substring(0, 500)}` : String(error)
			Logger.error(`[SdkController] Failed to init task: ${errorDetails}`)
			// Store error for debugging
			;(globalThis as Record<string, unknown>).__cline_last_init_error = errorDetails
			;(globalThis as Record<string, unknown>).__cline_last_init_error_raw = error
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

			// Look up the task in StateManager's task history first,
			// then fall back to the legacy file reader
			const history = (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
			let historyItem = history.find((item) => item.id === taskId)
			if (!historyItem) {
				historyItem = getHistoryItemById(taskId)
			}
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

			// Create VscodeSessionHost instance
			const sessionManager = await VscodeSessionHost.create({ mcpHub: this.mcpHub })

			// Subscribe to events
			const unsubscribe = sessionManager.subscribe((event: CoreSessionEvent) => {
				this.handleSessionEvent(event)
			})

			// For resumption, we start a new session with the same config
			// and let the SDK's persistence layer handle loading history.
			// The SDK will use the sessionId to find existing session data.
			const startResult = await sessionManager.start({
				config,
				prompt: `[TASK RESUMPTION] Resuming task: ${historyItem.task}`,
				interactive: true,
			})

			this.activeSession = {
				sessionId: startResult.sessionId,
				sessionManager,
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
			const { sessionManager, sessionId } = this.activeSession
			await sessionManager.abort(sessionId)
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
			const { sessionManager, unsubscribe, sessionId } = this.activeSession

			// Unsubscribe from events
			unsubscribe()

			// Stop the session (best-effort)
			try {
				await sessionManager.stop(sessionId)
			} catch (error) {
				Logger.warn("[SdkController] Error stopping session during clear:", error)
			}

			// Dispose the session manager instance
			try {
				await sessionManager.dispose("clearTask")
			} catch (error) {
				Logger.warn("[SdkController] Error disposing session manager during clear:", error)
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
	 *
	 * Like initTask(), this is fire-and-forget: core.send() blocks until
	 * the agent turn completes, but events stream in real-time via the
	 * subscription. We do NOT await the send — the gRPC handler needs to
	 * return immediately so the webview stays responsive.
	 */
	async askResponse(prompt?: string, images?: string[], files?: string[]): Promise<void> {
		if (!this.activeSession) {
			Logger.error("[SdkController] askResponse: No active session")
			return
		}

		const { sessionManager, sessionId } = this.activeSession
		this.activeSession.isRunning = true

		// Reset translator state for new turn
		this.messageTranslatorState.reset()

		// Fire-and-forget: send the follow-up message without awaiting.
		// Events stream in real-time via the subscription.
		sessionManager
			.send({
				sessionId,
				prompt: prompt ?? "",
				userImages: images,
				userFiles: files,
			})
			.then(() => {
				Logger.log(`[SdkController] Agent turn completed for session: ${sessionId}`)
				if (this.activeSession) {
					this.activeSession.isRunning = false
				}
				this.postStateToWebview().catch((err) => {
					Logger.error("[SdkController] Failed to post state after askResponse turn:", err)
				})
			})
			.catch((error) => {
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
					{ type: "status", payload: { sessionId, status: "error" } },
				)
				if (this.activeSession) {
					this.activeSession.isRunning = false
				}
				this.postStateToWebview().catch(() => {})
			})

		Logger.log(`[SdkController] Message sent (fire-and-forget) to session: ${sessionId}`)
	}

	/**
	 * Show a task from history by loading its messages.
	 * This does NOT start inference — it just loads the task for viewing.
	 *
	 * IMPORTANT: We do NOT call clearTask() here because clearTask() sets
	 * this.task = undefined and may trigger async operations (session stop/dispose)
	 * that race with the new task proxy creation. If any of those async operations
	 * trigger postStateToWebview() while this.task is undefined, the webview
	 * receives a state with no currentTaskItem/clineMessages and flashes back
	 * to the welcome screen (S6-6/S6-23 fix).
	 *
	 * Instead, we:
	 * 1. Silently tear down the active session (unsubscribe + stop in background)
	 * 2. Create the new task proxy with loaded messages BEFORE any state push
	 * 3. Only then push state to the webview
	 */
	async showTaskWithId(taskId: string): Promise<void> {
		try {
			// Look up the task in StateManager's task history (which is where
			// updateTaskHistory writes). Fall back to the legacy file reader.
			const history = (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
			let historyItem = history.find((item) => item.id === taskId)
			if (!historyItem) {
				// Fallback: try the legacy file reader
				historyItem = getHistoryItemById(taskId)
			}
			if (!historyItem) {
				Logger.error(`[SdkController] Task not found in history: ${taskId}`)
				return
			}

			// Silently tear down any active session WITHOUT clearing this.task
			// (prevents race condition where state push sees task=undefined)
			if (this.activeSession) {
				const { sessionManager, unsubscribe, sessionId } = this.activeSession
				// Unsubscribe FIRST to prevent stale events from triggering state pushes
				unsubscribe()
				this.activeSession = undefined
				// Stop and dispose in background — don't await, don't let errors propagate
				sessionManager.stop(sessionId).catch(() => {})
				sessionManager.dispose("showTaskWithId").catch(() => {})
			}

			// Clear old task proxy's messages (if any)
			if (this.task) {
				this.task.messageStateHandler.clear()
			}

			// Reset translator state
			this.messageTranslatorState.reset()

			// Create the new task proxy BEFORE pushing state
			this.task = createTaskProxy(
				taskId,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)

			// Load the task's messages from disk and add them to the message state handler
			// so the webview can display them.
			// IMPORTANT: Use getSavedClineMessages (from disk.ts) instead of readUiMessages
			// (from legacy-state-reader.ts) because they use different base paths:
			// - getSavedClineMessages: HostProvider.globalStorageFsPath/tasks/<id>/ui_messages.json
			// - readUiMessages: ~/.cline/data/tasks/<id>/ui_messages.json
			// saveClineMessages writes to the HostProvider path, so we must read from there too.
			const { getSavedClineMessages } = await import("@core/storage/disk")
			const messages = await getSavedClineMessages(taskId)
			if (messages.length > 0) {
				this.task.messageStateHandler.addMessages(messages)
				Logger.log(`[SdkController] Loaded ${messages.length} messages for task: ${taskId}`)

				// Also push each message through the partial message stream.
				// The webview receives messages from two sources:
				// 1. State updates (subscribeToState) — sets clineMessages in bulk
				// 2. Partial messages (subscribeToPartialMessage) — appends/updates by ts
				// Pushing through both ensures the webview has messages regardless
				// of any timing issues with the state update. The webview deduplicates
				// by timestamp, so duplicate pushes are harmless.
				const { pushMessageToWebview } = await import("./webview-grpc-bridge")
				for (const msg of messages) {
					await pushMessageToWebview(msg)
				}
			} else {
				Logger.log(`[SdkController] No messages found for task: ${taskId}`)
			}

			// Now push state — this.task is set with messages, so the webview
			// will see currentTaskItem + clineMessages and show the chat view
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

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: unknown[]
	}> {
		const history = (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
		const historyItem = history.find((item) => item.id === id)
		if (historyItem) {
			const taskDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks", id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const contextHistoryFilePath = path.join(taskDirPath, GlobalFileNames.contextHistory)
			const taskMetadataFilePath = path.join(taskDirPath, GlobalFileNames.taskMetadata)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
			if (fileExists) {
				const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					contextHistoryFilePath,
					taskMetadataFilePath,
					apiConversationHistory,
				}
			}
		}
		// If we tried to get a task that doesn't exist, remove it from state
		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	async exportTaskWithId(_id: string): Promise<void> {
		stubWarn("exportTaskWithId")
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		const history = this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined
		const updated = (history || []).filter((item) => item.id !== id)
		await this.stateManager.setGlobalState("taskHistory", updated)
		return updated
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		const history = (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
		const index = history.findIndex((h) => h.id === item.id)
		if (index >= 0) {
			history[index] = item
		} else {
			history.unshift(item)
		}
		await this.stateManager.setGlobalState("taskHistory", history)
		return history
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
