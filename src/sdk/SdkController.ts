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
import { type CoreSessionEvent, type SessionHost, type StartSessionResult } from "@clinebot/core"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import { mentionRegexGlobal } from "@shared/context-mentions"
import type { ClineApiReqInfo, ClineAskQuestion, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog } from "@shared/mcp"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import { parseMentions } from "@/core/mentions"
import { ensureMcpServersDirectoryExists, GlobalFileNames } from "@/core/storage/disk"
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
import { buildAgentHooks, buildHookExtensions, type HookMessageEmitter } from "./hooks-adapter"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"
import { MessageTranslatorState, sdkToolToClineSayTool, translateSessionEvent } from "./message-translator"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import { VscodeSessionHost } from "./vscode-session-host"
import { pushMessageToWebview, WebviewGrpcBridge } from "./webview-grpc-bridge"

/**
 * Log a stub warning and return undefined.
 */
function stubWarn(name: string): void {
	Logger.warn(`[SdkController] STUB: ${name} not yet implemented`)
}

/**
 * Check if an error is an AbortError — the expected result of calling
 * AbortController.abort() during task cancellation.
 */
function isAbortError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError" || error.message.toLowerCase().includes("aborted")
	}
	return false
}

// ---------------------------------------------------------------------------
// Auto-approval → SDK tool policies
// ---------------------------------------------------------------------------

/**
 * Build SDK `toolPolicies` from the user's `AutoApprovalSettings`.
 *
 * The SDK defaults all tools to `{ autoApprove: true }` when no policy is
 * set, so we only need to emit entries for tools that should NOT be
 * auto-approved. This ensures `requestToolApproval` is called for tools
 * the user hasn't enabled.
 */
function buildToolPolicies(
	settings: AutoApprovalSettings,
	mcpHub?: McpHub,
): Record<string, { enabled?: boolean; autoApprove?: boolean }> {
	const policies: Record<string, { enabled?: boolean; autoApprove?: boolean }> = {}

	const set = (tools: string[], autoApprove: boolean) => {
		for (const tool of tools) {
			policies[tool] = { autoApprove }
		}
	}

	// Read operations
	set(
		["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"],
		!!settings.actions.readFiles,
	)

	// Write operations
	set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"], !!settings.actions.editFiles)

	// Command execution
	const commandAutoApprove = !!settings.actions.executeAllCommands || !!settings.actions.executeSafeCommands
	set(["run_commands", "execute_command"], commandAutoApprove)

	// Browser / web
	set(["fetch_web_content", "web_fetch", "web_search"], !!settings.actions.useBrowser)

	// MCP tools — gated by the global `useMcp` toggle AND per-tool autoApprove flags.
	// When `useMcp` is off, ALL MCP tools require approval.
	// When `useMcp` is on, each tool's individual `autoApprove` flag decides.
	if (mcpHub) {
		const mcpEnabled = !!settings.actions.useMcp
		for (const server of mcpHub.getServers()) {
			for (const tool of server.tools ?? []) {
				const sdkName = `${server.name}__${tool.name}`
				const autoApprove = mcpEnabled && !!tool.autoApprove
				policies[sdkName] = { autoApprove }
			}
		}
	}

	return policies
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

	// Pending ask_question resolve — when the SDK's built-in ask_question tool
	// fires, we store the Promise resolve function here. When the user responds
	// via askResponse(), we call it to return the answer to the SDK.
	private pendingAskResolve: ((answer: string) => void) | undefined

	// Pending tool approval resolve — when the SDK calls requestToolApproval
	// for a non-auto-approved tool, we store the Promise resolve function here.
	// When the user clicks Approve/Reject in the webview, askResponse() resolves
	// this promise with { approved: true/false }.
	private pendingToolApprovalResolve: ((result: { approved: boolean; reason?: string }) => void) | undefined

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

		// Add to message state handler if a task proxy exists, otherwise
		// the messages are only emitted to listeners (webview bridge).
		if (this.task?.messageStateHandler) {
			this.task.messageStateHandler.addMessages(messages)
			this.debouncedSaveClineMessages()
		}

		this.emitSessionEvents(messages, {
			type: "status",
			payload: { sessionId: this.activeSession?.sessionId ?? "", status: "error" },
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

		// Suppress completion_result messages that arrive after cancellation.
		// When cancelTask() runs, it sets isRunning=false and emits resume_task.
		// Late-arriving "done" events from the SDK produce completion_result
		// which would override the resume_task button with "Start New Task".
		// During normal completion, isRunning is still true when the done event
		// fires, so this filter only affects the cancellation race condition.
		if (this.activeSession && !this.activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

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
		Logger.log(
			`[SdkController] Task usage: tokensIn=${usage.tokensIn}, tokensOut=${usage.tokensOut}, cost=${usage.totalCost ?? 0}`,
		)

		const taskId = this.task?.taskId ?? this.activeSession?.sessionId
		if (!taskId) {
			return
		}

		const history = (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
		const historyItem = history.find((item) => item.id === taskId)
		if (!historyItem) {
			return
		}

		historyItem.tokensIn = usage.tokensIn
		historyItem.tokensOut = usage.tokensOut
		historyItem.totalCost = usage.totalCost ?? 0
		historyItem.ts = Date.now()

		this.updateTaskHistory(historyItem).catch((error) => {
			Logger.error("[SdkController] Failed to persist task usage:", error)
		})
	}

	// ---- Hook message emitter ----

	/**
	 * Build an emitter-aware AgentHooks that pushes hook_status ClineMessages
	 * to the webview whenever a hook runs.
	 *
	 * Each emitted message is:
	 * 1. Added to the task proxy's messageStateHandler (so state includes it)
	 * 2. Pushed through the partial message stream (so the webview renders it)
	 * 3. Persisted to disk via debounced save
	 */
	private buildHooksWithEmitter(): ReturnType<typeof buildAgentHooks> {
		const emitter: HookMessageEmitter = (msg) => {
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages([msg])
				this.debouncedSaveClineMessages()
			}
			// Push through the partial message stream for immediate rendering
			pushMessageToWebview(msg).catch(() => {})
		}
		return buildAgentHooks(this.stateManager, emitter)
	}

	private buildExtensionsWithEmitter(): ReturnType<typeof buildHookExtensions> {
		const emitter: HookMessageEmitter = (msg) => {
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages([msg])
				this.debouncedSaveClineMessages()
			}
			// Push through the partial message stream for immediate rendering
			pushMessageToWebview(msg).catch(() => {})
		}
		return buildHookExtensions(this.stateManager, emitter)
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

	/**
	 * Handle the SDK's `requestToolApproval` callback for non-auto-approved tools.
	 *
	 * Converts the SDK tool request to a `ClineSayTool` JSON message, emits it
	 * as a `type: "ask", ask: "tool"` ClineMessage (triggering the webview's
	 * existing approval UI), and returns a Promise that resolves when the user
	 * clicks Approve or Reject.
	 */
	private async handleRequestToolApproval(request: {
		agentId: string
		conversationId: string
		iteration: number
		toolCallId: string
		toolName: string
		input: unknown
		policy: { enabled?: boolean; autoApprove?: boolean }
	}): Promise<{ approved: boolean; reason?: string }> {
		// Convert SDK tool name + input to ClineSayTool JSON for the webview
		const sayTool = sdkToolToClineSayTool(request.toolName, request.input)

		// Emit as ClineMessage with type:"ask", ask:"tool"
		// This is the same format the classic extension uses for tool approval dialogs
		const toolAskMessage: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "tool",
			text: JSON.stringify(sayTool),
			partial: false,
		}

		// Add to message state and push to webview
		if (this.task?.messageStateHandler) {
			this.task.messageStateHandler.addMessages([toolAskMessage])
			this.debouncedSaveClineMessages()
		}
		this.emitSessionEvents([toolAskMessage], {
			type: "status",
			payload: { sessionId: this.activeSession?.sessionId ?? "", status: "running" },
		})
		await this.postStateToWebview()

		// Return a Promise that resolves when the user clicks Approve/Reject
		return new Promise<{ approved: boolean; reason?: string }>((resolve) => {
			this.pendingToolApprovalResolve = resolve
		})
	}

	/**
	 * Handle the SDK's built-in `ask_question` tool executor.
	 *
	 * Emits a `type: "ask", ask: "followup"` ClineMessage with `ClineAskQuestion`
	 * JSON (the same format as the classic `ask_followup_question` tool), and
	 * returns a Promise that resolves when the user responds via `askResponse()`.
	 */
	private async handleAskQuestion(question: string, options: string[], _context: unknown): Promise<string> {
		// Build ClineAskQuestion JSON (same format as classic ask_followup_question)
		const askData: ClineAskQuestion = {
			question,
			options: options?.length ? options : undefined,
		}

		// Emit as ClineMessage with type:"ask", ask:"followup"
		const askMessage: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify(askData),
			partial: false,
		}

		// Add to message state and push to webview
		if (this.task?.messageStateHandler) {
			this.task.messageStateHandler.addMessages([askMessage])
			this.debouncedSaveClineMessages()
		}
		this.emitSessionEvents([askMessage], {
			type: "status",
			payload: { sessionId: this.activeSession?.sessionId ?? "", status: "running" },
		})
		await this.postStateToWebview()

		// Return a Promise that resolves when the user responds via askResponse()
		return new Promise<string>((resolve) => {
			this.pendingAskResolve = resolve
		})
	}

	/**
	 * Create a new VscodeSessionHost, subscribe to events, start a session,
	 * and wire up `this.activeSession`.
	 *
	 * This is the common session-bootstrap sequence shared by `initTask`,
	 * `resumeSessionFromTask`, `reinitExistingTaskFromId`, and
	 * `restartSessionForMcpTools`.
	 *
	 * @returns The `StartSessionResult` from the SDK.
	 */
	private async startNewSession(
		startInput: Parameters<VscodeSessionHost["start"]>[0],
	): Promise<{ startResult: StartSessionResult; sessionManager: SessionHost }> {
		// Build tool policies from user's auto-approval settings so the SDK
		// knows which tools require explicit user approval.
		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const toolPolicies = autoApprovalSettings ? buildToolPolicies(autoApprovalSettings, this.mcpHub) : undefined

		const sessionManager = await VscodeSessionHost.create({
			mcpHub: this.mcpHub,
			requestToolApproval: (request) => this.handleRequestToolApproval(request),
			askQuestion: (question, options, context) => this.handleAskQuestion(question, options, context),
			toolPolicies,
		})
		const unsubscribe = sessionManager.subscribe((event: CoreSessionEvent) => {
			this.handleSessionEvent(event)
		})

		const startResult = await sessionManager.start(startInput)

		this.activeSession = {
			sessionId: startResult.sessionId,
			sessionManager,
			unsubscribe,
			startResult,
			isRunning: true,
		}

		return { startResult, sessionManager }
	}

	/**
	 * Fire-and-forget: send a prompt to the active session.
	 *
	 * `sessionManager.send()` blocks until the agent turn completes, but
	 * events stream in real-time via the subscription. We do NOT await the
	 * send — the caller (gRPC handler / UI) needs to return immediately.
	 */
	private fireAndForgetSend(
		sessionManager: SessionHost,
		sessionId: string,
		prompt: string,
		images?: string[],
		files?: string[],
		delivery?: "queue" | "steer",
	): void {
		sessionManager
			.send({
				sessionId,
				prompt,
				userImages: images,
				userFiles: files,
				delivery,
			})
			.then((result) => {
				// When delivery is "queue", send() returns undefined immediately
				// (the message was enqueued, the turn didn't complete). Don't
				// update isRunning — the agent is still mid-turn.
				if (delivery === "queue" || delivery === "steer") {
					Logger.log(`[SdkController] Message queued for session: ${sessionId}`)
					return
				}
				Logger.log(`[SdkController] Agent turn completed for session: ${sessionId}`)
				if (this.activeSession) {
					this.activeSession.isRunning = false
				}
				this.postStateToWebview().catch((err) => {
					Logger.error("[SdkController] Failed to post state after turn:", err)
				})
			})
			.catch((error: unknown) => {
				// AbortError is expected when the user cancels a running task.
				// The cancelTask() method handles emitting the appropriate UI
				// messages, so we just silently absorb the error here.
				if (isAbortError(error)) {
					Logger.debug(`[SdkController] Agent turn aborted (expected): ${sessionId}`)
					return
				}
				Logger.error("[SdkController] Agent turn failed:", error)

				// Detect auth errors for the 'cline' provider so the webview
				// shows the "Sign in to Cline" button instead of a raw error.
				const errorMessage = error instanceof Error ? error.message : String(error)
				const isClineAuthError =
					this.isClineProviderActive() &&
					(errorMessage.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
						errorMessage.toLowerCase().includes("missing api key") ||
						errorMessage.toLowerCase().includes("unauthorized"))

				if (isClineAuthError) {
					this.emitClineAuthError()
				} else {
					this.emitSessionEvents(
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
				if (this.activeSession) {
					this.activeSession.isRunning = false
				}
				this.postStateToWebview().catch(() => {})
			})
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
			const config = await buildSessionConfig({
				prompt: task,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})
			config.hooks = this.buildHooksWithEmitter()
			config.extensions = [...(config.extensions ?? []), ...this.buildExtensionsWithEmitter()]
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

			// Create host, subscribe, start session, wire activeSession
			const { startResult, sessionManager } = await this.startNewSession(startInput)

			// Create a task proxy for gRPC handlers
			this.task = createTaskProxy(
				startResult.sessionId,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)

			// Create and save a history item for this task
			const newHistoryItem = createHistoryItemFromSession(startResult.sessionId, task ?? "", config.modelId, cwd)
			await this.updateTaskHistory(newHistoryItem)

			// Emit initial task message — must be added to messageStateHandler
			// so that getStateToPostToWebview() includes it in clineMessages.
			const taskMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "task",
				text: task ?? "",
				partial: false,
			}
			this.task.messageStateHandler.addMessages([taskMessage])
			this.emitSessionEvents([taskMessage], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: "running" },
			})

			await this.postStateToWebview()

			// Send the prompt to start inference (fire-and-forget)
			if (task?.trim()) {
				Logger.log(`[SdkController] Sending prompt to session: ${startResult.sessionId}`)
				// Resolve @mentions (file content, URLs, diagnostics, git state)
				// before sending to the SDK, which doesn't handle them natively.
				const resolvedTask = await this.resolveContextMentions(task)
				this.fireAndForgetSend(sessionManager, startResult.sessionId, resolvedTask, images, files)
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
			const cwd = historyItem.cwdOnTaskInitialization ?? (await this.getWorkspaceRoot())
			const config = await buildSessionConfig({
				cwd,
				mode: "act", // Default to act mode for resumed tasks
			})
			config.hooks = this.buildHooksWithEmitter()
			config.extensions = [...(config.extensions ?? []), ...this.buildExtensionsWithEmitter()]

			// Create a temporary session host to read old messages before
			// starting the new session (start() overwrites the session row)
			const tempManager = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
			const initialMessages = await this.loadInitialMessages(tempManager, taskId)
			await tempManager.dispose("readMessages")

			// Start a new session with the old conversation history
			const { startResult } = await this.startNewSession({
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
				this.emitSessionEvents(
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
		this.pendingAskResolve = undefined
		if (this.pendingToolApprovalResolve) {
			this.pendingToolApprovalResolve({ approved: false, reason: "Task cancelled" })
			this.pendingToolApprovalResolve = undefined
		}

		if (!this.activeSession) {
			Logger.warn("[SdkController] cancelTask: No active session")
			return
		}

		const { sessionManager, sessionId } = this.activeSession

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

		this.activeSession.isRunning = false

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
		if (this.task?.messageStateHandler) {
			this.task.messageStateHandler.addMessages([resumeMessage])
			this.debouncedSaveClineMessages()
		}
		this.emitSessionEvents([resumeMessage], { type: "status", payload: { sessionId, status: "cancelled" } })

		await this.postStateToWebview()
		Logger.log(`[SdkController] Task cancelled: ${sessionId}`)
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	async clearTask(): Promise<void> {
		// Clear any pending ask_question or tool approval — the session is being torn down
		this.pendingAskResolve = undefined
		if (this.pendingToolApprovalResolve) {
			this.pendingToolApprovalResolve({ approved: false, reason: "Task cleared" })
			this.pendingToolApprovalResolve = undefined
		}

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
		// Check if a tool approval is pending (requestToolApproval callback waiting).
		// The TaskProxy stores the response type in taskState.askResponse before
		// calling this method, so we can determine approve vs reject.
		if (this.pendingToolApprovalResolve) {
			const resolve = this.pendingToolApprovalResolve
			this.pendingToolApprovalResolve = undefined

			const responseType = this.task?.taskState?.askResponse
			const approved = responseType === "yesButtonClicked"
			Logger.log(`[SdkController] Resolving pending tool approval: approved=${approved} (responseType=${responseType})`)

			resolve({
				approved,
				...(approved ? {} : { reason: prompt || "User denied the tool execution" }),
			})
			return
		}

		// Check if the SDK's ask_question tool is waiting for a response.
		// If so, resolve the pending promise with the user's answer and return
		// — we do NOT send a new message to the SDK in this case.
		if (this.pendingAskResolve) {
			const resolve = this.pendingAskResolve
			this.pendingAskResolve = undefined

			const responseText = prompt ?? ""
			Logger.log(`[SdkController] Resolving pending ask_question with: "${responseText.substring(0, 80)}"`)

			// Render the user's response in the chat timeline
			if (responseText) {
				const userMessage: ClineMessage = {
					ts: Date.now(),
					type: "say",
					say: "user_feedback",
					text: responseText,
					partial: false,
				}
				if (this.task?.messageStateHandler) {
					this.task.messageStateHandler.addMessages([userMessage])
					this.debouncedSaveClineMessages()
				}
				this.emitSessionEvents([userMessage], {
					type: "status",
					payload: { sessionId: this.activeSession?.sessionId ?? "", status: "running" },
				})
			}

			resolve(responseText)
			return
		}

		// If the user is viewing an old task (this.task is set by showTaskWithId)
		// but there's no active SDK session, we need to resume the session first.
		// Also resume when the session was cancelled (isRunning === false) — the
		// underlying SDK session is dead after abort, so we must create a new one
		// with the conversation history as initialMessages.
		if ((!this.activeSession || !this.activeSession.isRunning) && this.task) {
			Logger.log(`[SdkController] askResponse: No active session but task exists (${this.task.taskId}), resuming...`)
			try {
				await this.resumeSessionFromTask(this.task.taskId, prompt, images, files)
			} catch (error) {
				Logger.error("[SdkController] Failed to resume session from task:", error)

				// Detect auth errors for the 'cline' provider
				const errorMsg = error instanceof Error ? error.message : String(error)
				const isClineAuth =
					this.isClineProviderActive() &&
					(errorMsg.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
						errorMsg.toLowerCase().includes("missing api key") ||
						errorMsg.toLowerCase().includes("unauthorized"))

				if (isClineAuth) {
					this.emitClineAuthError()
				} else {
					this.emitSessionEvents(
						[
							{
								ts: Date.now(),
								type: "say",
								say: "error",
								text: `Failed to resume task: ${errorMsg}`,
								partial: false,
							},
						],
						{ type: "status", payload: { sessionId: this.task.taskId, status: "error" } },
					)
				}
				await this.postStateToWebview()
			}
			return
		}

		if (!this.activeSession) {
			Logger.error("[SdkController] askResponse: No active session")
			return
		}

		const { sessionManager, sessionId } = this.activeSession

		// If the session is already running (agent mid-turn), use delivery: "queue"
		// so the SDK enqueues the message instead of throwing "already in progress".
		// The SDK will drain the queue after the current turn completes.
		const wasAlreadyRunning = this.activeSession.isRunning
		const delivery = wasAlreadyRunning ? ("queue" as const) : undefined

		if (wasAlreadyRunning) {
			Logger.log(`[SdkController] Session is running — queuing follow-up message for session: ${sessionId}`)
		}

		this.activeSession.isRunning = true

		// Mirror classic behavior: render the user's follow-up message immediately
		// so it appears in the chat timeline before assistant streaming begins.
		const hasPrompt = !!prompt?.trim()
		const hasImages = !!images?.length
		const hasFiles = !!files?.length
		if (hasPrompt || hasImages || hasFiles) {
			const userMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "user_feedback",
				text: prompt ?? "",
				images,
				files,
				partial: false,
			}
			if (this.task?.messageStateHandler) {
				this.task.messageStateHandler.addMessages([userMessage])
				this.debouncedSaveClineMessages()
			}
			this.emitSessionEvents([userMessage], {
				type: "status",
				payload: { sessionId, status: "running" },
			})
		}

		// Reset translator state for new turn (only if not queuing — queued
		// messages will be processed after the current turn completes)
		if (!wasAlreadyRunning) {
			this.messageTranslatorState.reset()
		}

		// Resolve @mentions before sending to the SDK
		const resolvedPrompt = prompt ? await this.resolveContextMentions(prompt) : ""

		// Fire-and-forget send (with delivery: "queue" if session was already running)
		this.fireAndForgetSend(sessionManager, sessionId, resolvedPrompt, images, files, delivery)
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

		// Look up the HistoryItem for cwd and metadata
		const history = (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
		const historyItem = history.find((item) => item.id === taskId)
		const cwd = historyItem?.cwdOnTaskInitialization ?? (await this.getWorkspaceRoot())

		// Build a new session config, reusing the old task ID
		const modeValue = this.stateManager.getGlobalSettingsKey("mode")
		const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
		const config = await buildSessionConfig({ cwd, mode })
		config.hooks = this.buildHooksWithEmitter()
		config.extensions = [...(config.extensions ?? []), ...this.buildExtensionsWithEmitter()]
		config.sessionId = taskId

		// Load conversation history BEFORE start() (which overwrites the session row).
		// Use a temporary session host for reading, then dispose it.
		const tempManager = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
		const initialMessages = await this.loadInitialMessages(tempManager, taskId)
		await tempManager.dispose("readMessages")

		Logger.log(`[SdkController] Resuming with ${initialMessages?.length ?? 0} initial messages`)

		// Start a new session with the old conversation history
		const { startResult, sessionManager } = await this.startNewSession({
			config,
			interactive: true,
			...(initialMessages
				? { initialMessages: initialMessages as Parameters<VscodeSessionHost["start"]>[0]["initialMessages"] }
				: {}),
		})

		// Update task proxy's session ID if it changed
		if (this.task && this.task.taskId !== startResult.sessionId) {
			this.task.taskId = startResult.sessionId
		}

		this.messageTranslatorState.reset()

		// Update the HistoryItem
		if (historyItem) {
			historyItem.ts = Date.now()
			historyItem.modelId = config.modelId
			await this.updateTaskHistory(historyItem)
		}

		// Emit the user's message to the webview
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

		// Send the follow-up message (fire-and-forget).
		// Always send a resumption prompt when the user didn't type anything —
		// this matches the classic extension's behavior where clicking "Resume Task"
		// without text still sends a [TASK RESUMPTION] message to the agent.
		const effectivePrompt =
			prompt?.trim() ||
			(historyItem
				? `[TASK RESUMPTION] This task was interrupted. It may or may not be complete, so please reassess the task context. The conversation history has been preserved. New instructions from the user: ${historyItem.task}`
				: "[TASK RESUMPTION] Please continue where you left off.")

		// Resolve @mentions before sending to the SDK
		const resolvedPrompt = await this.resolveContextMentions(effectivePrompt)

		this.fireAndForgetSend(sessionManager, startResult.sessionId, resolvedPrompt, images, files)
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
			const cwd = await this.getWorkspaceRoot()
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
			const config = await buildSessionConfig({ cwd, mode })
			config.hooks = this.buildHooksWithEmitter()
			config.extensions = [...(config.extensions ?? []), ...this.buildExtensionsWithEmitter()]
			// Preserve the existing task/session ID so currentTaskItem continues
			// to resolve from taskHistory and the webview doesn't flash back to
			// a blank/new-task state after MCP server toggles.
			config.sessionId = oldSessionId

			// 2. Read conversation history from the OLD session BEFORE tearing it down.
			// Without this, the new session starts with zero context and the LLM
			// loses memory of the entire conversation.
			const initialMessages = await this.loadInitialMessages(oldManager, oldSessionId)

			// 3. Tear down the old session BEFORE starting the new one, so
			// startNewSession() doesn't overwrite this.activeSession while the
			// old subscription is still active.
			oldUnsubscribe()
			oldManager.stop(oldSessionId).catch(() => {})
			oldManager.dispose("mcpToolRestart").catch(() => {})

			// 4. Start a new session with the old conversation history
			const startInput = buildStartSessionInput(config, { cwd, mode })
			const { startResult } = await this.startNewSession({
				...startInput,
				...(initialMessages
					? { initialMessages: initialMessages as Parameters<VscodeSessionHost["start"]>[0]["initialMessages"] }
					: {}),
			})

			// Session is idle after restart (no prompt was sent)
			if (this.activeSession) {
				this.activeSession.isRunning = false
			}

			// Keep the existing task proxy ID aligned with taskHistory.
			// If the SDK returned a different ID despite requesting oldSessionId,
			// keep the current task ID stable for webview state continuity.
			if (startResult.sessionId !== oldSessionId) {
				Logger.warn(
					`[SdkController] MCP tool restart returned a new session ID (${startResult.sessionId}); preserving task ID ${oldSessionId} for UI continuity`,
				)
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

	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		stubWarn("ensureWorkspaceManager")
		return undefined
	}
}
