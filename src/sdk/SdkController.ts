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
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import { mentionRegexGlobal } from "@shared/context-mentions"
import type { ClineApiReqInfo, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog } from "@shared/mcp"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import { parseMentions } from "@/core/mentions"
import { ensureMcpServersDirectoryExists } from "@/core/storage/disk"
import { StateManager } from "@/core/storage/StateManager"
import { type WorkspaceRootManager } from "@/core/workspace/WorkspaceRootManager"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { UrlContentFetcher } from "@/services/browser/UrlContentFetcher"
import { ClineError } from "@/services/error/ClineError"
import { McpHub } from "@/services/mcp/McpHub"
import { telemetryService } from "@/services/telemetry"
import { ClineExtensionContext } from "@/shared/cline"
import { Logger } from "@/shared/services/Logger"
import { ClineAccountService } from "./account-service"
import { AuthService, LogoutReason } from "./auth-service"
import { buildStartSessionInput, createHistoryItemFromSession } from "./cline-session-factory"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { SdkFollowupCoordinator } from "./sdk-followup-coordinator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMcpCoordinator } from "./sdk-mcp-coordinator"
import { SdkMessageCoordinator, type SessionEventListener } from "./sdk-message-coordinator"
import { SdkModeCoordinator } from "./sdk-mode-coordinator"
import { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import { SdkSessionFactory } from "./sdk-session-factory"
import { isAbortError, SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { SdkTaskHistory, type TaskWithId } from "./sdk-task-history"
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
// Controller
// ---------------------------------------------------------------------------

export class Controller {
	// SDK session state (Step 4)
	private messageTranslatorState: MessageTranslatorState
	private messages: SdkMessageCoordinator
	private sessions: SdkSessionLifecycle
	private interactions: SdkInteractionCoordinator
	private sessionConfigBuilder: SdkSessionConfigBuilder
	private taskHistory: SdkTaskHistory
	private mode: SdkModeCoordinator
	private mcpTools: SdkMcpCoordinator
	private followups: SdkFollowupCoordinator

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

		// Initialize SDK-backed auth and account services (Step 6)
		this.authService = AuthService.getInstance(this)
		this.ocaAuthService = this.authService
		this.accountService = ClineAccountService.getInstance()

		// Initialize message translator state
		this.messageTranslatorState = new MessageTranslatorState()
		this.messages = new SdkMessageCoordinator({ getTask: () => this.task })
		this.taskHistory = new SdkTaskHistory(this.stateManager)
		this.sessionConfigBuilder = new SdkSessionConfigBuilder({
			stateManager: this.stateManager,
			emitHookMessage: (msg) => this.messages.emitHookMessage(msg),
			onSwitchToActMode: () => {
				this.mode.queueSwitchToActMode()
			},
			shouldStopAfterModeSwitch: () => this.mode.hasPendingModeChange(),
		})
		this.interactions = new SdkInteractionCoordinator({
			messages: this.messages,
			getSessionId: () => this.sessions.getActiveSession()?.sessionId ?? "",
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.sessions = new SdkSessionLifecycle({
			factory: new SdkSessionFactory({
				stateManager: this.stateManager,
				mcpHub: this.mcpHub,
				requestToolApproval: (request) => this.interactions.handleRequestToolApproval(request),
				askQuestion: (question, options, context) => this.interactions.handleAskQuestion(question, options, context),
				onSessionEvent: (event) => this.handleSessionEvent(event),
			}),
			onSendComplete: async () => {
				if (this.mode.hasPendingModeChange()) {
					try {
						await this.mode.applyPendingModeChange()
					} catch (err) {
						Logger.error("[SdkController] applyPendingModeChange failed:", err)
					}
				}

				this.postStateToWebview().catch((err) => {
					Logger.error("[SdkController] Failed to post state after turn:", err)
				})
			},
			onSendError: async (error, sessionId) => {
				const errorMessage = error instanceof Error ? error.message : String(error)
				const isClineAuthError =
					this.isClineProviderActive() &&
					(errorMessage.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
						errorMessage.toLowerCase().includes("missing api key") ||
						errorMessage.toLowerCase().includes("unauthorized"))

				if (isClineAuthError) {
					this.emitClineAuthError()
				} else {
					this.messages.emitSessionEvents(
						[
							{
								ts: Date.now(),
								type: "say",
								say: "error",
								text: `Agent error: ${errorMessage}`,
								partial: false,
							},
						],
						{ type: "status", payload: { sessionId, status: "error" } },
					)
				}
				this.postStateToWebview().catch(() => {})
			},
		})
		this.mode = new SdkModeCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			interactions: this.interactions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getTask: () => this.task,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: (sessionManager, sessionId) => this.loadInitialMessages(sessionManager, sessionId),
			buildStartSessionInput,
			emitClineAuthError: () => this.emitClineAuthError(),
			resetMessageTranslator: () => this.messageTranslatorState.reset(),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.mcpTools = new SdkMcpCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: (sessionManager, sessionId) => this.loadInitialMessages(sessionManager, sessionId),
			buildStartSessionInput,
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.followups = new SdkFollowupCoordinator({
			stateManager: this.stateManager,
			interactions: this.interactions,
			sessions: this.sessions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getTask: () => this.task,
			createTempSessionHost: () => VscodeSessionHost.create({ mcpHub: this.mcpHub }),
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: (reader, taskId) => this.loadInitialMessages(reader, taskId),
			buildStartSessionInput,
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			isClineProviderActive: () => this.isClineProviderActive(),
			emitClineAuthError: () => this.emitClineAuthError(),
			resetMessageTranslator: () => this.messageTranslatorState.reset(),
			postStateToWebview: () => this.postStateToWebview(),
		})
		// Subscribe to MCP tool list changes so we can restart the SDK session
		// when servers are added/removed/reconnected. The SDK's DefaultSessionBuilder
		// does not support dynamic MCP tools, so we must restart the session.
		this.mcpHub.setToolListChangeCallback(() => this.mcpTools.handleToolListChanged())

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
		this.messages.cancelPendingSave()
		// Clear MCP tool list change callback before disposing McpHub
		this.mcpHub?.clearToolListChangeCallback()
		await this.clearTask()
		this.mcpHub?.dispose?.()
		this.messages.dispose()
		Logger.log("[SdkController] Disposed")
	}

	// ---- Context mention resolution ----

	/**
	 * Resolve `@` context mentions in user text before sending to the SDK.
	 *
	 * The classic extension's Task class called `parseMentions()` to inline
	 * file content (`@/path`), URL content (`@https://...`), diagnostics
	 * (`@problems`), git state (`@git-changes`), and commit info (`@hash`)
	 * into the prompt text. The SDK's own mention enricher only handles
	 * simple `@path` file mentions and doesn't support the webview's
	 * `@/path` format or special mentions.
	 *
	 * This method bridges the gap by calling the classic `parseMentions()`
	 * before the text is sent to the SDK, ensuring all context mentions
	 * are resolved into inline content that the LLM can see.
	 */
	private async resolveContextMentions(text: string): Promise<string> {
		// Quick check: skip if there are no @ mentions
		if (!mentionRegexGlobal.test(text)) {
			return text
		}
		// Reset lastIndex since RegExp.test() advances it for global regexes
		mentionRegexGlobal.lastIndex = 0

		try {
			const cwd = await this.getWorkspaceRoot()
			const urlContentFetcher = new UrlContentFetcher()
			const workspaceManager = await this.ensureWorkspaceManager()
			const resolved = await parseMentions(text, cwd, urlContentFetcher, undefined, workspaceManager)
			Logger.log(`[SdkController] Resolved context mentions (${text.length} → ${resolved.length} chars)`)
			return resolved
		} catch (error) {
			Logger.error("[SdkController] Failed to resolve context mentions, using raw text:", error)
			return text
		}
	}

	// ---- Workspace root resolution ----

	/**
	 * Get the user's workspace root directory.
	 *
	 * In VSCode this resolves to `vscode.workspace.workspaceFolders[0]` via
	 * `HostProvider.workspace.getWorkspacePaths()`. Falls back to
	 * `process.cwd()` only when no workspace folder is open (e.g. when the
	 * user opens VSCode without a folder).
	 *
	 * The classic extension used `vscode.workspace.workspaceFolders[0].uri.fsPath`
	 * directly; using HostProvider keeps this host-agnostic.
	 */
	private async getWorkspaceRoot(): Promise<string> {
		try {
			const { paths } = await HostProvider.workspace.getWorkspacePaths({})
			if (paths.length > 0 && paths[0]) {
				return paths[0]
			}
		} catch (error) {
			Logger.warn("[SdkController] Failed to get workspace paths, falling back to process.cwd():", error)
		}
		return process.cwd()
	}

	// ---- Session event subscription ----

	/**
	 * Subscribe to session events translated to ClineMessages.
	 * Returns an unsubscribe function.
	 */
	onSessionEvent(listener: SessionEventListener): () => void {
		return this.messages.onSessionEvent(listener)
	}

	/**
	 * Check if the active API provider is 'cline' (for current mode).
	 */
	private isClineProviderActive(): boolean {
		try {
			const apiConfig = this.stateManager.getApiConfiguration()
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode = modeValue === "plan" ? "plan" : "act"
			const provider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
			return provider === "cline"
		} catch {
			return false
		}
	}

	/**
	 * Emit a proper auth error for the 'cline' provider when the user is not
	 * logged in. This produces the same message sequence the classic extension
	 * emits, so the webview renders the "Sign in to Cline" button via ErrorRow.
	 *
	 * Message sequence:
	 *   1. say:'task'           – the user's message text
	 *   2. say:'api_req_started' – opens the API request row
	 *   3. ask:'api_req_failed'  – ClineError JSON → ErrorRow renders auth UI
	 */
	private emitClineAuthError(task?: string): void {
		const ts = Date.now()

		const clineError = new ClineError(
			{ message: CLINE_ACCOUNT_AUTH_ERROR_MESSAGE, status: 401 },
			undefined, // modelId
			"cline",
		)
		const serializedError = clineError.serialize()

		const messages: ClineMessage[] = [
			{
				ts,
				type: "say",
				say: "task",
				text: task ?? "",
				partial: false,
			},
			{
				ts: ts + 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					streamingFailedMessage: serializedError,
				} satisfies ClineApiReqInfo),
				partial: false,
			},
			{
				ts: ts + 2,
				type: "ask",
				ask: "api_req_failed",
				text: serializedError,
				partial: false,
			},
		]

		this.messages.appendAndEmit(messages, {
			type: "status",
			payload: { sessionId: this.sessions.getActiveSession()?.sessionId ?? "", status: "error" },
		})

		this.postStateToWebview().catch(() => {})
	}

	/**
	 * Handle an SDK session event.
	 * Translates the event and emits ClineMessages to listeners.
	 */
	private handleSessionEvent(event: CoreSessionEvent): void {
		// Log pending prompt events for visibility (SDK emits these when
		// queued messages are enqueued/consumed via delivery: "queue").
		if (event.type === "pending_prompts") {
			const count = event.payload.prompts.length
			Logger.log(
				`[SdkController] Pending prompts updated: ${count} prompt(s) in queue for session ${event.payload.sessionId}`,
			)
		} else if (event.type === "pending_prompt_submitted") {
			Logger.log(
				`[SdkController] Pending prompt submitted: "${event.payload.prompt.substring(0, 80)}" for session ${event.payload.sessionId}`,
			)
		}

		const result = translateSessionEvent(event, this.messageTranslatorState)
		const activeSession = this.sessions.getActiveSession()

		// Suppress completion_result messages that arrive after cancellation.
		// When cancelTask() runs, it sets isRunning=false and emits resume_task.
		// Late-arriving "done" events from the SDK produce completion_result
		// which would override the resume_task button with "Start New Task".
		// During normal completion, isRunning is still true when the done event
		// fires, so this filter only affects the cancellation race condition.
		if (activeSession && !activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

		if (result.messages.length > 0) {
			this.messages.appendAndEmit(result.messages, event)
		}

		// Update running state
		if (activeSession) {
			if (result.sessionEnded || result.turnComplete) {
				this.sessions.setRunning(false)

				// Check if MCP tools changed while we were mid-turn.
				// If so, restart the session now that the turn is complete.
				this.mcpTools.checkDeferredRestart()

				// If the model invoked `switch_to_act_mode` during this turn,
				// apply the queued mode change now that the turn is complete.
				// This mirrors the check in `fireAndForgetSend`'s completion
				// handler — wiring it here ensures we also catch the mode
				// change when turnComplete is signalled via the event stream
				// before (or instead of) the send() promise resolving.
				// Mirrors the CLI's plan → act flow in
				// apps/cli/src/runtime/run-interactive.ts.
				if (this.mode.hasPendingModeChange()) {
					this.mode.applyPendingModeChange().catch((err) => {
						Logger.error("[SdkController] applyPendingModeChange failed:", err)
					})
				}
			}

			// Update task history with usage info
			if (result.usage && activeSession.startResult) {
				this.taskHistory.updateTaskUsage(this.task?.taskId ?? this.sessions.getActiveSession()?.sessionId, result.usage)
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

	// ---- Session helpers (shared by initTask, resumeSessionFromTask, restartSessionForMcpTools, etc.) ----

	/**
	 * Load conversation history for an old session, to be passed as
	 * `initialMessages` when creating a replacement session.
	 *
	 * Tries the SDK's own persistence (SQLite/file) first via
	 * `sessionManager.readMessages()`, then falls back to the classic
	 * `api_conversation_history.json` for pre-SDK tasks.
	 *
	 * @param reader  An object with a `readMessages(id)` method — typically
	 *                a `VscodeSessionHost` or the old `sessionManager`.
	 * @param taskId  The session/task ID whose messages to load.
	 */
	private async loadInitialMessages(
		reader: { readMessages(id: string): Promise<unknown[]> },
		taskId: string,
	): Promise<unknown[] | undefined> {
		// 1. Try SDK-persisted messages (SQLite / file-backed session store)
		try {
			const sdkMessages = await reader.readMessages(taskId)
			if (sdkMessages.length > 0) {
				const sanitizedMessages = sanitizeInitialMessagesForSessionStart(sdkMessages)
				if (sanitizedMessages !== sdkMessages) {
					Logger.log(
						`[SdkController] Sanitized legacy pairing in SDK-persisted history for task: ${taskId} (${sdkMessages.length} → ${sanitizedMessages.length} messages)`,
					)
				}
				Logger.log(`[SdkController] Loaded ${sanitizedMessages.length} SDK-persisted messages for task: ${taskId}`)
				return sanitizedMessages
			}
		} catch (error) {
			Logger.warn("[SdkController] Failed to read SDK-persisted messages:", error)
		}

		// 2. Fallback: classic api_conversation_history.json (pre-SDK tasks)
		try {
			const { getSavedApiConversationHistory } = await import("@core/storage/disk")
			const apiHistory = await getSavedApiConversationHistory(taskId)
			if (apiHistory.length > 0) {
				const sanitizedMessages = sanitizeInitialMessagesForSessionStart(apiHistory as unknown[])
				if (sanitizedMessages !== apiHistory) {
					Logger.log(
						`[SdkController] Sanitized legacy pairing in classic API history for task: ${taskId} (${apiHistory.length} → ${sanitizedMessages.length} messages)`,
					)
				}
				Logger.log(`[SdkController] Loaded ${sanitizedMessages.length} classic API messages for task: ${taskId}`)
				return sanitizedMessages
			}
		} catch (error) {
			Logger.warn("[SdkController] Failed to read classic API conversation history:", error)
		}

		return undefined
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
			const cwd = await this.getWorkspaceRoot()
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
			Logger.log(`[SdkController] Building session config: mode=${mode}, cwd=${cwd}`)
			const config = await this.sessionConfigBuilder.build({
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

			// Pre-check: if using the 'cline' provider without auth, emit a
			// proper auth error so the webview shows the "Sign in to Cline"
			// button instead of a raw SDK error.
			if (config.providerId === "cline" && !config.apiKey) {
				Logger.warn("[SdkController] Cline provider selected but no auth token — emitting auth error")
				this.emitClineAuthError(task)
				return undefined
			}

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

			// Create host, subscribe, start session, wire active session
			const { startResult, sessionManager } = await this.sessions.startNewSession(startInput)

			// Create a task proxy for gRPC handlers
			this.task = createTaskProxy(
				startResult.sessionId,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)

			// Create and save a history item for this task
			const newHistoryItem = createHistoryItemFromSession(startResult.sessionId, task ?? "", config.modelId, cwd)
			await this.taskHistory.updateTaskHistory(newHistoryItem)

			// Emit initial task message — must be added to messageStateHandler
			// so that getStateToPostToWebview() includes it in clineMessages.
			const taskMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "task",
				text: task ?? "",
				partial: false,
			}
			this.messages.appendAndEmit(
				[taskMessage],
				{
					type: "status",
					payload: { sessionId: startResult.sessionId, status: "running" },
				},
				{ save: false },
			)

			await this.postStateToWebview()

			// Send the prompt to start inference (fire-and-forget)
			if (task?.trim()) {
				Logger.log(`[SdkController] Sending prompt to session: ${startResult.sessionId}`)
				// Resolve @mentions (file content, URLs, diagnostics, git state)
				// before sending to the SDK, which doesn't handle them natively.
				const resolvedTask = await this.resolveContextMentions(task)
				this.sessions.fireAndForgetSend(sessionManager, startResult.sessionId, resolvedTask, images, files)
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
			this.messages.emitSessionEvents(
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
			const historyItem = this.taskHistory.findHistoryItem(taskId)
			if (!historyItem) {
				Logger.error(`[SdkController] Task not found in history: ${taskId}`)
				return
			}

			// Build session config from the history item's context
			const cwd = historyItem.cwdOnTaskInitialization ?? (await this.getWorkspaceRoot())
			const reinitMode: Mode = "act" // Default to act mode for resumed tasks
			const config = await this.sessionConfigBuilder.build({
				cwd,
				mode: reinitMode,
			})

			// Create a temporary session host to read old messages before
			// starting the new session (start() overwrites the session row)
			const tempManager = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
			const initialMessages = await this.loadInitialMessages(tempManager, taskId)
			await tempManager.dispose("readMessages")

			// Start a new session with the old conversation history
			const { startResult } = await this.sessions.startNewSession({
				config,
				interactive: true,
				...(initialMessages
					? { initialMessages: initialMessages as Parameters<VscodeSessionHost["start"]>[0]["initialMessages"] }
					: {}),
			})

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

			// Detect auth errors for the 'cline' provider
			const reinitErrorMsg = error instanceof Error ? error.message : String(error)
			const isClineAuthReinit =
				this.isClineProviderActive() &&
				(reinitErrorMsg.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
					reinitErrorMsg.toLowerCase().includes("missing api key") ||
					reinitErrorMsg.toLowerCase().includes("unauthorized"))

			if (isClineAuthReinit) {
				this.emitClineAuthError()
			} else {
				this.messages.emitSessionEvents(
					[
						{
							ts: Date.now(),
							type: "say",
							say: "error",
							text: `Failed to resume task: ${reinitErrorMsg}`,
							partial: false,
						},
					],
					{ type: "status", payload: { sessionId: taskId, status: "error" } },
				)
			}
		}
	}

	async cancelTask(): Promise<void> {
		// Clear any pending ask_question or tool approval — they are moot after cancellation
		this.interactions.clearPending("Task cancelled")

		const activeSession = this.sessions.getActiveSession()
		if (!activeSession) {
			Logger.warn("[SdkController] cancelTask: No active session")
			return
		}

		const { sessionManager, sessionId } = activeSession

		try {
			await sessionManager.abort(sessionId)
		} catch (error) {
			// AbortError is the expected result of AbortController.abort() — suppress it.
			if (!isAbortError(error)) {
				Logger.error("[SdkController] Failed to abort session:", error)
			} else {
				Logger.debug(`[SdkController] AbortError during cancelTask (expected): ${sessionId}`)
			}
		}

		this.sessions.setRunning(false)

		// Emit resume_task ask so the webview shows the "Resume task" button
		// and enables follow-up message input. This mirrors the classic
		// extension's behavior in Task.abortTask().
		const resumeMessage: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "resume_task",
			text: "",
			partial: false,
		}
		this.messages.appendAndEmit([resumeMessage], { type: "status", payload: { sessionId, status: "cancelled" } })

		await this.postStateToWebview()
		Logger.log(`[SdkController] Task cancelled: ${sessionId}`)
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	async clearTask(): Promise<void> {
		// Clear any pending ask_question or tool approval — the session is being torn down
		this.interactions.clearPending("Task cleared")

		const activeSession = this.sessions.clearActiveSessionReference()
		if (activeSession) {
			const { sessionManager, unsubscribe, sessionId } = activeSession

			// Clear the reference FIRST so that any re-entrant calls
			// (e.g., from event handlers triggered during stop/dispose)
			// see no active session and don't try to stop it again.
			unsubscribe()

			// Stop and dispose the session (best-effort, with timeout).
			// The stop()/dispose() calls can hang if the session is in
			// an unexpected state (e.g., after MCP tool restart created
			// a session that was never sent a prompt). Use a timeout to
			// prevent blocking the UI.
			const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
				Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])

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
				const finalizedMessages = this.messages.finalizeMessagesForSave(messages)
				try {
					const { saveClineMessages } = await import("@core/storage/disk")
					await saveClineMessages(taskId, finalizedMessages)
				} catch (err) {
					Logger.error("[SdkController] Failed to save finalized messages during clearTask:", err)
				}
			}

			// Cancel any pending debounced save (the finalized save above supersedes it)
			this.messages.cancelPendingSave()

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
		await this.followups.askResponse(prompt, images, files, this.task?.taskState?.askResponse)
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
			const historyItem = this.taskHistory.findHistoryItem(taskId)
			if (!historyItem) {
				Logger.error(`[SdkController] Task not found in history: ${taskId}`)
				return
			}

			// Silently tear down any active session WITHOUT clearing this.task
			// (prevents race condition where state push sees task=undefined)
			const activeSession = this.sessions.clearActiveSessionReference()
			if (activeSession) {
				const { sessionManager, unsubscribe, sessionId } = activeSession
				// Unsubscribe FIRST to prevent stale events from triggering state pushes
				unsubscribe()
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
			const messages = this.messages.finalizeMessagesForSave(rawMessages)

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

				this.messages.appendMessages(cleanedMessages, { save: false })
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
		return this.mode.toggleActModeForYoloMode()
	}

	async togglePlanActMode(modeToSwitchTo: Mode, _chatContent?: ChatContent): Promise<boolean> {
		return this.mode.togglePlanActMode(modeToSwitchTo)
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

	async getTaskWithId(id: string): Promise<TaskWithId> {
		return this.taskHistory.getTaskWithId(id)
	}

	async exportTaskWithId(_id: string): Promise<void> {
		stubWarn("exportTaskWithId")
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		return this.taskHistory.deleteTaskFromState(id)
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		return this.taskHistory.updateTaskHistory(item)
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
			const state = await classicGetState({
				task: this.task,
				stateManager: this.stateManager,
				mcpHub: this.mcpHub,
				backgroundCommandRunning: this.backgroundCommandRunning,
				backgroundCommandTaskId: this.backgroundCommandTaskId,
			})
			// NOTE: Prior to the foreground-terminal removal on main (PR #10196,
			// commit 1862f1595), we had to override state.vscodeTerminalExecutionMode
			// = "backgroundExec" so CommandOutputRow would render the background-exec
			// UI (cancel button, log file links, correct status text). After that PR
			// the webview unconditionally treats every command as background-exec
			// (ChatRow hardcodes isBackgroundExec={true}), and the field was removed
			// from ExtensionState, so the override is no longer necessary.
			return state
		} catch (error) {
			Logger.error("[SdkController] Failed to get state for webview:", error)
			throw error
		}
	}

	// ---- Workspace (kept from classic) ----

	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		stubWarn("ensureWorkspaceManager")
		return undefined
	}
}
