// Replaces classic src/core/controller/index.ts (see origin/main)
//
// This is the SDK-backed Controller. It provides the same interface as the
// classic Controller but delegates to the Cline SDK (@clinebot/core).
//
// Step 4: Session lifecycle methods (initTask, askResponse, cancelTask, etc.)
// Step 5: gRPC thunking layer — bridges SDK events to webview gRPC streams

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { CoreSessionEvent } from "@clinebot/core"
import type { ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import type { ClineApiReqInfo, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog } from "@shared/mcp"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import { ensureMcpServersDirectoryExists, GlobalFileNames } from "@/core/storage/disk"
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

	// MCP tool list change tracking — when the tool list changes mid-session,
	// we need to restart the SDK session to pick up the new tools.
	// If the session is mid-turn, we defer the restart until the turn completes.
	private mcpToolRestartPending = false

	constructor(readonly context: ClineExtensionContext) {
		// StateManager must be initialized before creating the Controller
		this.stateManager = StateManager.get()

		// MCP hub — using classic McpHub for now (Step 7).
		// Will be replaced by SDK's InMemoryMcpManager in Step 10 (Cleanup).
		// IMPORTANT: Use ~/.cline/data/settings/ for the settings directory,
		// NOT ensureSettingsDirectoryExists() which returns the VSCode extension
		// storage path (HostProvider.globalStorageFsPath/settings/). The MCP
		// settings file lives at ~/.cline/data/settings/cline_mcp_settings.json
		// (shared across VSCode, CLI, and JetBrains clients).
		this.mcpHub = new McpHub(
			() => ensureMcpServersDirectoryExists(),
			async () => {
				const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
				const settingsDir = path.join(clineDir, "data", "settings")
				await fs.mkdir(settingsDir, { recursive: true })
				return settingsDir
			},
			ExtensionRegistryInfo.version,
			telemetryService,
		)

		// Subscribe to MCP tool list changes so we can restart the SDK session
		// when servers are added/removed/reconnected. The SDK's DefaultSessionBuilder
		// does not support dynamic MCP tools, so we must restart the session.
		this.mcpHub.setToolListChangeCallback(() => this.handleMcpToolListChanged())

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
		// Clear MCP tool list change callback before disposing McpHub
		this.mcpHub?.clearToolListChangeCallback()
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

				// Check if MCP tools changed while we were mid-turn.
				// If so, restart the session now that the turn is complete.
				this.checkDeferredMcpToolRestart()
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

			// Clear the reference FIRST so that any re-entrant calls
			// (e.g., from event handlers triggered during stop/dispose)
			// see no active session and don't try to stop it again.
			this.activeSession = undefined

			// Unsubscribe from events
			unsubscribe()

			// Stop and dispose the session (best-effort, with timeout).
			// The stop()/dispose() calls can hang if the session is in
			// an unexpected state (e.g., after MCP tool restart created
			// a session that was never sent a prompt). Use a timeout to
			// prevent blocking the UI.
			const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | void> =>
				Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])

			try {
				await withTimeout(sessionManager.stop(sessionId), 3000)
			} catch (error) {
				Logger.warn("[SdkController] Error stopping session during clear:", error)
			}

			try {
				await withTimeout(sessionManager.dispose("clearTask"), 3000)
			} catch (error) {
				Logger.warn("[SdkController] Error disposing session manager during clear:", error)
			}
		}

		// Finalize messages on disk before clearing the task proxy.
		// This ensures that when the user navigates back to this task,
		// the messages don't still appear as "streaming" with partial=true.
		if (this.task) {
			const taskId = this.task.taskId
			const messages = this.task.messageStateHandler.getClineMessages()
			if (taskId && messages.length > 0) {
				// Clear partial flags and update last api_req_started with cancel reason
				const finalizedMessages = this.finalizeMessagesForSave(messages)
				try {
					const { saveClineMessages } = await import("@core/storage/disk")
					await saveClineMessages(taskId, finalizedMessages)
				} catch (err) {
					Logger.error("[SdkController] Failed to save finalized messages during clearTask:", err)
				}
			}

			// Cancel any pending debounced save (the finalized save above supersedes it)
			if (this.saveClineMessagesTimer) {
				clearTimeout(this.saveClineMessagesTimer)
				this.saveClineMessagesTimer = undefined
			}

			this.task.messageStateHandler.clear()
			this.task = undefined
		}

		// Reset translator state
		this.messageTranslatorState.reset()
	}

	/**
	 * Finalize messages for saving to disk when a task is being cleared.
	 * - Strips `partial` flags so the UI doesn't show a streaming/cancel state
	 * - Updates the last `api_req_started` with a cancel reason if it has no cost
	 */
	private finalizeMessagesForSave(messages: ClineMessage[]): ClineMessage[] {
		return messages.map((msg, index) => {
			const updated = { ...msg }

			// Clear partial flag
			if (updated.partial) {
				delete updated.partial
			}

			// If this is the last api_req_started without a cost, mark it as user_cancelled
			if (updated.type === "say" && updated.say === "api_req_started") {
				try {
					const info: ClineApiReqInfo = JSON.parse(updated.text || "{}")
					if (info.cost === undefined && info.cancelReason === undefined) {
						// Check if this is the last api_req_started in the list
						const isLast = !messages.slice(index + 1).some((m) => m.type === "say" && m.say === "api_req_started")
						if (isLast) {
							info.cancelReason = "user_cancelled"
							updated.text = JSON.stringify(info)
						}
					}
				} catch {
					// ignore parse errors
				}
			}

			return updated
		})
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
		// If the user is viewing an old task (this.task is set by showTaskWithId)
		// but there's no active SDK session, we need to resume the session first.
		if (!this.activeSession && this.task) {
			Logger.log(`[SdkController] askResponse: No active session but task exists (${this.task.taskId}), resuming...`)
			try {
				await this.resumeSessionFromTask(this.task.taskId, prompt, images, files)
			} catch (error) {
				Logger.error("[SdkController] Failed to resume session from task:", error)
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
					{ type: "status", payload: { sessionId: this.task.taskId, status: "error" } },
				)
				await this.postStateToWebview()
			}
			return
		}

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
	 * Resume an old task by spinning up a new SDK session with the old
	 * conversation history as initialMessages, then sending the user's
	 * follow-up message.
	 *
	 * This handles the case where the user clicked on an old task
	 * (showTaskWithId loaded UI messages into this.task) and then typed
	 * a follow-up message. Since showTaskWithId does NOT create an
	 * activeSession, we need to create one here with the full API
	 * conversation history so the model has context.
	 */
	private async resumeSessionFromTask(taskId: string, prompt?: string, images?: string[], files?: string[]): Promise<void> {
		Logger.log(`[SdkController] Resuming session from task: ${taskId}`)

		// ── Task 2: Look up the HistoryItem for cwd and metadata ──
		const history = (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
		const historyItem = history.find((item) => item.id === taskId)
		const cwd = historyItem?.cwdOnTaskInitialization ?? process.cwd()

		// ── Task 3: Build a new session config ──
		const modeValue = this.stateManager.getGlobalSettingsKey("mode")
		const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
		const config = await buildSessionConfig({ cwd, mode })
		// Reuse the old task ID as the session ID so history item linkage is preserved
		config.sessionId = taskId

		// ── Task 4: Create VscodeSessionHost and subscribe to events ──
		const sessionManager = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
		const unsubscribe = sessionManager.subscribe((event: CoreSessionEvent) => {
			this.handleSessionEvent(event)
		})

		// ── Task 1: Load conversation history ──
		// The SDK persists messages to its own storage (SQLite/file) during
		// runTurn(). For SDK-created tasks, api_conversation_history.json
		// does NOT exist — only ui_messages.json is written by the controller.
		// So we read from the SDK's persistence via readMessages() first,
		// then fall back to the classic api_conversation_history.json for
		// tasks created by the classic (non-SDK) controller.
		// IMPORTANT: Read BEFORE start() since start() with the same sessionId
		// will overwrite the session row/manifest.
		let initialMessages: Parameters<typeof sessionManager.start>[0]["initialMessages"]
		try {
			const sdkMessages = await sessionManager.readMessages(taskId)
			if (sdkMessages.length > 0) {
				initialMessages = sdkMessages
				Logger.log(`[SdkController] Loaded ${sdkMessages.length} SDK-persisted messages for task: ${taskId}`)
			}
		} catch (error) {
			Logger.warn("[SdkController] Failed to read SDK-persisted messages:", error)
		}

		// Fallback: try classic api_conversation_history.json (for pre-SDK tasks)
		if (!initialMessages || initialMessages.length === 0) {
			try {
				const { getSavedApiConversationHistory } = await import("@core/storage/disk")
				const apiHistory = await getSavedApiConversationHistory(taskId)
				if (apiHistory.length > 0) {
					// Cast is safe: Anthropic.MessageParam and LlmsProviders.Message
					// are structurally compatible ({role, content} with compatible content types)
					initialMessages = apiHistory as unknown as typeof initialMessages
					Logger.log(`[SdkController] Loaded ${apiHistory.length} classic API messages for task: ${taskId}`)
				}
			} catch (error) {
				Logger.warn("[SdkController] Failed to read classic API conversation history:", error)
			}
		}

		Logger.log(`[SdkController] Resuming with ${initialMessages?.length ?? 0} initial messages`)

		// ── Task 5: Start the session with initialMessages ──
		// Pass the old conversation history as initialMessages so the agent
		// has full context. The SDK's executeAgentTurn will see
		// agent.getMessages().length > 0 and call agent.continue() instead of
		// agent.run(), correctly appending to the existing conversation.
		const startInput: Parameters<typeof sessionManager.start>[0] = {
			config,
			interactive: true,
			...(initialMessages && initialMessages.length > 0 ? { initialMessages } : {}),
		}

		const startResult = await sessionManager.start(startInput)

		// ── Task 6: Wire up the activeSession ──
		this.activeSession = {
			sessionId: startResult.sessionId,
			sessionManager,
			unsubscribe,
			startResult,
			isRunning: true,
		}

		// Update task proxy's session ID if it changed (shouldn't, since we set config.sessionId)
		if (this.task && this.task.taskId !== startResult.sessionId) {
			this.task.taskId = startResult.sessionId
		}

		// Reset translator state for the new turn
		this.messageTranslatorState.reset()

		// ── Task 8: Update the HistoryItem ──
		if (historyItem) {
			historyItem.ts = Date.now()
			historyItem.modelId = config.modelId
			await this.updateTaskHistory(historyItem)
		}

		// ── Task 9: Emit the user's message to the webview ──
		if (prompt?.trim()) {
			const userMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "user_feedback",
				text: prompt,
				partial: false,
			}
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages([userMessage])
				this.debouncedSaveClineMessages()
			}
			this.emitSessionEvents([userMessage], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: "running" },
			})
		}

		await this.postStateToWebview()

		// ── Task 7: Send the user's follow-up message (fire-and-forget) ──
		// ── Task 10: Edge case — if no conversation history and no prompt, use summary ──
		const effectivePrompt =
			prompt?.trim() ||
			((!initialMessages || initialMessages.length === 0) && historyItem
				? `[TASK RESUMPTION] Resuming task: ${historyItem.task}`
				: "")

		if (effectivePrompt) {
			const sid = startResult.sessionId
			sessionManager
				.send({
					sessionId: sid,
					prompt: effectivePrompt,
					userImages: images,
					userFiles: files,
				})
				.then(() => {
					Logger.log(`[SdkController] Resumed turn completed for session: ${sid}`)
					if (this.activeSession) {
						this.activeSession.isRunning = false
					}
					this.postStateToWebview().catch((err) => {
						Logger.error("[SdkController] Failed to post state after resumed turn:", err)
					})
				})
				.catch((error) => {
					Logger.error("[SdkController] Resumed turn failed:", error)
					this.emitSessionEvents(
						[
							{
								ts: Date.now(),
								type: "say",
								say: "error",
								text: `Failed to resume: ${error instanceof Error ? error.message : String(error)}`,
								partial: false,
							},
						],
						{ type: "status", payload: { sessionId: sid, status: "error" } },
					)
					if (this.activeSession) {
						this.activeSession.isRunning = false
					}
					this.postStateToWebview().catch(() => {})
				})

			Logger.log(`[SdkController] Resume message sent (fire-and-forget) to session: ${sid}`)
		} else {
			// No prompt and we have API history — session is ready but idle
			this.activeSession.isRunning = false
			Logger.log(`[SdkController] Session resumed (idle, no prompt) for task: ${taskId}`)
		}
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
			const rawMessages = await getSavedClineMessages(taskId)

			// Sanitize loaded messages: strip partial flags and clean up incomplete api requests.
			// Messages may have been saved mid-stream if the task was interrupted.
			const messages = this.finalizeMessagesForSave(rawMessages)

			if (messages.length > 0) {
				// Determine whether to show "Resume Task" or "Start New Task" button
				const lastRelevantMessage = [...messages]
					.reverse()
					.find((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
				const isCompletedTask = lastRelevantMessage?.ask === "completion_result"
				const resumeAsk = isCompletedTask ? "resume_completed_task" : "resume_task"

				// Remove any old resume messages then append a fresh one
				const cleanedMessages = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
				const resumeMessage: ClineMessage = {
					ts: Date.now(),
					type: "ask",
					ask: resumeAsk,
					text: "",
				}
				cleanedMessages.push(resumeMessage)

				this.task.messageStateHandler.addMessages(cleanedMessages)
				Logger.log(`[SdkController] Loaded ${cleanedMessages.length} messages for task: ${taskId} (with ${resumeAsk})`)

				// Also push each message through the partial message stream.
				// The webview receives messages from two sources:
				// 1. State updates (subscribeToState) — sets clineMessages in bulk
				// 2. Partial messages (subscribeToPartialMessage) — appends/updates by ts
				// Pushing through both ensures the webview has messages regardless
				// of any timing issues with the state update. The webview deduplicates
				// by timestamp, so duplicate pushes are harmless.
				const { pushMessageToWebview } = await import("./webview-grpc-bridge")
				for (const msg of cleanedMessages) {
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
		try {
			await this.mcpHub.completeOAuth(serverHash, code, state)
			await this.postStateToWebview()
		} catch (error) {
			Logger.error("Failed to complete MCP OAuth:", error)
		}
	}

	// ---- MCP marketplace (Step 7) ----

	async refreshMcpMarketplace(_sendCatalogEvent: boolean): Promise<McpMarketplaceCatalog | undefined> {
		stubWarn("refreshMcpMarketplace")
		return undefined
	}

	// ---- Provider auth callbacks (Step 6) ----

	async handleOpenRouterCallback(code: string): Promise<void> {
		await this.authService.handleOpenRouterCallback(code)
		await this.postStateToWebview()
	}

	async handleRequestyCallback(code: string): Promise<void> {
		await this.authService.handleRequestyCallback(code)
		await this.postStateToWebview()
	}

	async handleHicapCallback(code: string): Promise<void> {
		await this.authService.handleHicapCallback(code)
		await this.postStateToWebview()
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

	// ---- MCP tool list change handling ----

	/**
	 * Called by McpHub when the set of available MCP tools changes
	 * (servers added/removed/reconnected, tools discovered/lost).
	 *
	 * The SDK's DefaultSessionBuilder does not support dynamic MCP tools —
	 * tools are loaded once at session build time. To pick up new tools,
	 * we must restart the session with a new VscodeSessionHost (which
	 * creates a new VscodeRuntimeBuilder that reads the current tool list).
	 *
	 * Strategy:
	 * - If no active session: nothing to do (next initTask will pick up tools)
	 * - If session is idle (not mid-turn): restart immediately
	 * - If session is mid-turn: set a flag and restart when the turn completes
	 */
	private handleMcpToolListChanged(): void {
		Logger.log("[SdkController] MCP tool list changed")

		if (!this.activeSession) {
			Logger.log("[SdkController] No active session — tools will be picked up on next initTask")
			return
		}

		if (this.activeSession.isRunning) {
			Logger.log("[SdkController] Session is mid-turn — deferring MCP tool restart")
			this.mcpToolRestartPending = true
			return
		}

		// Session is idle — restart now
		this.restartSessionForMcpTools().catch((error) => {
			Logger.error("[SdkController] Failed to restart session for MCP tools:", error)
		})
	}

	/**
	 * Check if a deferred MCP tool restart is pending and execute it.
	 * Called after a turn completes (from the send() .then() handlers).
	 */
	private checkDeferredMcpToolRestart(): void {
		if (!this.mcpToolRestartPending) {
			return
		}
		this.mcpToolRestartPending = false

		if (!this.activeSession) {
			Logger.log("[SdkController] Deferred MCP restart: no active session, skipping")
			return
		}

		Logger.log("[SdkController] Executing deferred MCP tool restart")
		this.restartSessionForMcpTools().catch((error) => {
			Logger.error("[SdkController] Failed deferred MCP tool restart:", error)
		})
	}

	/**
	 * Restart the active SDK session to pick up changed MCP tools.
	 *
	 * This creates a new VscodeSessionHost (with a fresh VscodeRuntimeBuilder
	 * that reads the current McpHub tool list), starts a new session with the
	 * same config, and preserves the conversation by loading messages from the
	 * old session. The old session is stopped and disposed.
	 *
	 * The user sees an informational message in the chat about the tool reload.
	 */
	private async restartSessionForMcpTools(): Promise<void> {
		if (!this.activeSession) {
			return
		}

		const { sessionManager: oldManager, unsubscribe: oldUnsubscribe, sessionId: oldSessionId } = this.activeSession

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for MCP tool changes`)

		// Emit an info message so the user knows what's happening
		const infoMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "info",
			text: "MCP tools changed — reloading tools for this session...",
			partial: false,
		}
		if (this.task?.messageStateHandler) {
			this.task.messageStateHandler.addMessages([infoMessage])
			this.debouncedSaveClineMessages()
		}
		this.emitSessionEvents([infoMessage], {
			type: "status",
			payload: { sessionId: oldSessionId, status: "running" },
		})

		try {
			// 1. Build fresh session config (same provider/model/mode)
			const cwd = process.cwd()
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
			const config = await buildSessionConfig({ cwd, mode })

			// 2. Create a new VscodeSessionHost with fresh MCP tools
			const newManager = await VscodeSessionHost.create({ mcpHub: this.mcpHub })

			// 3. Subscribe to events on the new manager
			const newUnsubscribe = newManager.subscribe((event: CoreSessionEvent) => {
				this.handleSessionEvent(event)
			})

			// 4. Start a new session (no prompt — just create it)
			const startInput = buildStartSessionInput(config, { cwd, mode })
			const startResult = await newManager.start(startInput)

			// 5. Tear down the old session
			oldUnsubscribe()
			oldManager.stop(oldSessionId).catch(() => {})
			oldManager.dispose("mcpToolRestart").catch(() => {})

			// 6. Update active session
			this.activeSession = {
				sessionId: startResult.sessionId,
				sessionManager: newManager,
				unsubscribe: newUnsubscribe,
				startResult,
				isRunning: false,
			}

			// 7. Update the task proxy's session ID (keep existing messages)
			if (this.task) {
				this.task.taskId = startResult.sessionId
			}

			// Emit success message
			const successMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "info",
				text: "MCP tools reloaded successfully. You can continue your conversation.",
				partial: false,
			}
			// Emit ask:"completion_result" so the webview knows the agent is
			// idle and enables the follow-up input. Without this, the webview
			// stays in "Thinking..." state because clineAsk is not set (S6-30).
			const completionAsk: ClineMessage = {
				ts: Date.now() + 1,
				type: "ask",
				ask: "completion_result",
				text: "",
				partial: false,
			}
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages([successMessage, completionAsk])
				this.debouncedSaveClineMessages()
			}
			this.emitSessionEvents([successMessage, completionAsk], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: "idle" },
			})

			await this.postStateToWebview()
			Logger.log(`[SdkController] Session restarted for MCP tools: ${oldSessionId} → ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to restart session for MCP tools:", error)

			// Emit error message but don't crash — the old session may still work
			// for non-MCP tools
			const errorMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: `Failed to reload MCP tools: ${error instanceof Error ? error.message : String(error)}. MCP tools may be outdated.`,
				partial: false,
			}
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages([errorMessage])
				this.debouncedSaveClineMessages()
			}
			this.emitSessionEvents([errorMessage], {
				type: "status",
				payload: { sessionId: oldSessionId, status: "error" },
			})
			await this.postStateToWebview()
		}
	}

	// ---- Workspace (kept from classic) ----

	async ensureWorkspaceManager(): Promise<unknown> {
		stubWarn("ensureWorkspaceManager")
		return undefined
	}
}
