// Replaces classic src/core/controller/index.ts (see origin/main)
//
// This is the SDK-backed Controller. It provides the same interface as the
// classic Controller but delegates to the Cline SDK (@cline/core).
//
// Step 4: Session lifecycle methods (initTask, askResponse, cancelTask, etc.)
// Step 5: gRPC thunking layer — bridges SDK events to webview gRPC streams
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { PreparedRemoteConfigCoreIntegration, SessionHistoryRecord } from "@cline/core"
import { formatDisplayUserInput, type RemoteConfig, type RemoteConfigBundle } from "@cline/shared"
import type { ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import { mentionRegexGlobal } from "@shared/context-mentions"
import type { ClineApiReqInfo, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog, McpMarketplaceItem } from "@shared/mcp"
import { DeleteAllTaskHistoryCount, GetTaskHistoryRequest, TaskHistoryArray, TaskResponse } from "@shared/proto/cline/task"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import axios from "axios"
import { ClineEnv } from "@/config"
import { sendMcpMarketplaceCatalogEvent } from "@/core/controller/mcp/subscribeToMcpMarketplaceCatalog"
import { parseMentions } from "@/core/mentions"
import { ensureMcpServersDirectoryExists, writeMcpMarketplaceCatalogToCache } from "@/core/storage/disk"
import { refreshSdkRemoteConfig } from "@/core/storage/remote-config/sdk-refresh"
import { clearRemoteConfig } from "@/core/storage/remote-config/utils"
import { StateManager } from "@/core/storage/StateManager"
import { type WorkspaceRootManager } from "@/core/workspace/WorkspaceRootManager"
import { HostProvider } from "@/hosts/host-provider"
import type { ITerminalManager } from "@/integrations/terminal/types"
import { ExtensionRegistryInfo } from "@/registry"
import { UrlContentFetcher } from "@/services/browser/UrlContentFetcher"
import { ClineError } from "@/services/error/ClineError"
import { McpHub } from "@/services/mcp/McpHub"
import { telemetryService } from "@/services/telemetry"
import { ClineExtensionContext } from "@/shared/cline"
import { getAxiosSettings } from "@/shared/net"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { arePathsEqual, getDesktopDir } from "@/utils/path"
import { ClineAccountService } from "./account-service"
import { AuthService, LogoutReason } from "./auth-service"
import { buildStartSessionInput, createHistoryItemFromSession } from "./cline-session-factory"
import { MessageTranslatorState, reshapeErrorForWebview } from "./message-translator"
import { createProviderCatalog } from "./model-catalog/catalog"
import type { Disposable, ProviderCatalog, ProviderConfigChange, ProviderConfigStore } from "./model-catalog/contracts"
import { createProviderConfigStore } from "./model-catalog/store"
import { SdkFollowupCoordinator } from "./sdk-followup-coordinator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMcpCoordinator } from "./sdk-mcp-coordinator"
import { SdkMessageCoordinator, type SessionEventListener } from "./sdk-message-coordinator"
import { SdkModeCoordinator } from "./sdk-mode-coordinator"
import { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import { SdkSessionEventCoordinator } from "./sdk-session-event-coordinator"
import { SdkSessionHistoryLoader } from "./sdk-session-history-loader"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { SdkTaskControlCoordinator } from "./sdk-task-control-coordinator"
import { SdkTaskHistory, sessionHistoryRecordToHistoryItem } from "./sdk-task-history"
import { SdkTaskStartCoordinator } from "./sdk-task-start-coordinator"
import { isToolAutoApproved } from "./sdk-tool-policies"
import type { TaskProxy } from "./task-proxy"
import { VscodeSessionHost } from "./vscode-session-host"
import { WebviewGrpcBridge } from "./webview-grpc-bridge"
import { resolveWorkspaceRootPath } from "./workspace-root"

/**
 * Log a stub warning and return undefined.
 */
function stubWarn(name: string): void {
	Logger.warn(`[SdkController] STUB: ${name} not yet implemented`)
}

function metadataNumber(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): number | undefined {
	const value = metadata?.[key]
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function metadataBoolean(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): boolean | undefined {
	const value = metadata?.[key]
	return typeof value === "boolean" ? value : undefined
}

function metadataString(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): string | undefined {
	const value = metadata?.[key]
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function dateStringToTimestamp(value: string | null | undefined): number {
	if (!value) {
		return 0
	}
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp) ? timestamp : 0
}

function historyItemToTaskResponse(item: HistoryItem): TaskResponse {
	return TaskResponse.create({
		id: item.id,
		task: formatDisplayUserInput(item.task),
		ts: item.ts,
		isFavorited: item.isFavorited ?? false,
		size: item.size ?? 0,
		totalCost: item.totalCost ?? 0,
		tokensIn: item.tokensIn ?? 0,
		tokensOut: item.tokensOut ?? 0,
		cacheWrites: item.cacheWrites ?? 0,
		cacheReads: item.cacheReads ?? 0,
	})
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
	private taskControl: SdkTaskControlCoordinator
	private taskStart: SdkTaskStartCoordinator
	private sessionEvents: SdkSessionEventCoordinator
	private sessionHistory: SdkSessionHistoryLoader
	private readonly providerConfigStore: ProviderConfigStore
	private readonly providerCatalog: ProviderCatalog
	private readonly providerConfigStoreSubscription: Disposable
	private providerConfigStatePostScheduled = false

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

	// Lazy terminal manager for foreground terminal execution.
	// Concrete impl comes from HostProvider (VscodeTerminalManager in VSCode,
	// StandaloneTerminalManager in cline-core / JetBrains).
	// Created on first use; shared across all sessions in this Controller's lifetime.
	private _terminalManager?: ITerminalManager

	// Private state kept for stub compatibility
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string

	// Timer for periodic remote config fetching (enterprise policy enforcement)
	private remoteConfigTimer?: NodeJS.Timeout
	private remoteConfigCoreIntegration?: PreparedRemoteConfigCoreIntegration

	get remoteConfig(): RemoteConfig | undefined {
		return this.remoteConfigCoreIntegration?.prepared.bundle?.remoteConfig
	}

	get remoteConfigBundle(): RemoteConfigBundle | undefined {
		return this.remoteConfigCoreIntegration?.prepared.bundle
	}

	constructor(readonly context: ClineExtensionContext) {
		// StateManager must be initialized before creating the Controller
		this.stateManager = StateManager.get()
		this.providerConfigStore = createProviderConfigStore()
		this.providerCatalog = createProviderCatalog(this.providerConfigStore)
		this.providerConfigStoreSubscription = this.providerConfigStore.subscribe((event) => {
			this.handleProviderConfigChange(event)
		})

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
		this.sessionHistory = new SdkSessionHistoryLoader()
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
			shouldAutoApproveTool: (request) => {
				const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
				return autoApprovalSettings ? isToolAutoApproved(request.toolName, autoApprovalSettings, this.mcpHub) : false
			},
		})
		this.sessions = new SdkSessionLifecycle({
			mcpHub: this.mcpHub,
			requestToolApproval: (request) => this.interactions.handleRequestToolApproval(request),
			askQuestion: (question, options, context) => this.interactions.handleAskQuestion(question, options, context),
			onSessionEvent: (event) => {
				this.sessionEvents.handleSessionEvent(event).catch((err) => {
					Logger.error("[SdkController] Failed to handle session event:", err)
				})
			},
			getRemoteConfigIntegration: () => this.remoteConfigCoreIntegration,
			getTerminalManager: () => {
				if (!this._terminalManager) {
					this._terminalManager = HostProvider.get().createTerminalManager()
					this.applyTerminalSettings(this._terminalManager)
					Logger.log(
						`[SdkController] Created ${this._terminalManager.constructor.name} for foreground terminal execution`,
					)
				}
				return this._terminalManager
			},
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
				} else if (this.isClineProviderActive() && this.isClineBalanceError(errorMessage)) {
					this.emitClineBalanceError(errorMessage)
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
		this.taskHistory = new SdkTaskHistory({
			mcpHub: this.mcpHub,
			sessions: this.sessions,
		})
		this.mode = new SdkModeCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			interactions: this.interactions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getTask: () => this.task,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: async (sdkHost, sessionId) =>
				(await this.sessionHistory.loadInitialMessages(sdkHost, sessionId)) ?? [],
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
			loadInitialMessages: async (sdkHost, sessionId) =>
				(await this.sessionHistory.loadInitialMessages(sdkHost, sessionId)) ?? [],
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
			loadInitialMessages: (sessionHost, taskId) => this.sessionHistory.loadInitialMessages(sessionHost, taskId),
			buildStartSessionInput,
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			isClineProviderActive: () => this.isClineProviderActive(),
			emitClineAuthError: () => this.emitClineAuthError(),
			resetMessageTranslator: () => this.messageTranslatorState.reset(),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.taskControl = new SdkTaskControlCoordinator({
			sessions: this.sessions,
			interactions: this.interactions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			getTask: () => this.task,
			setTask: (task) => {
				this.task = task
			},
			onAskResponse: (text, images, files) => this.askResponse(text, images, files),
			resetMessageTranslator: () => this.messageTranslatorState.reset(),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.taskStart = new SdkTaskStartCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			sessionConfigBuilder: this.sessionConfigBuilder,
			buildStartSessionInput,
			createHistoryItemFromSession,
			clearTask: () => this.clearTask(),
			setTask: (task) => {
				this.task = task
			},
			onAskResponse: (text, images, files) => this.askResponse(text, images, files),
			onCancelTask: () => this.cancelTask(),
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			createTempSessionHost: () => VscodeSessionHost.create({ mcpHub: this.mcpHub }),
			loadInitialMessages: (reader, taskId) => this.sessionHistory.loadInitialMessages(reader, taskId),
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			isClineProviderActive: () => this.isClineProviderActive(),
			emitClineAuthError: (task) => this.emitClineAuthError(task),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.sessionEvents = new SdkSessionEventCoordinator({
			messageTranslatorState: this.messageTranslatorState,
			sessions: this.sessions,
			messages: this.messages,
			mcpTools: this.mcpTools,
			mode: this.mode,
			taskHistory: this.taskHistory,
			stateManager: this.stateManager,
			getTask: () => this.task,
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

		// Restore auth state from secrets on startup, then start the remote
		// config polling timer (enterprise policy enforcement). The timer must
		// start after auth is restored so remote config can identify the user's
		// organization and apply org-level policies.
		this.authService
			.restoreRefreshTokenAndRetrieveAuthInfo()
			.then(() => {
				this.startRemoteConfigTimer()
			})
			.catch((err) => {
				Logger.error("[SdkController] Failed to restore auth state:", err)
			})

		Logger.log("[SdkController] Initialized with SDK adapter layer + gRPC bridge + auth services")
	}

	getProviderConfigStore(): ProviderConfigStore {
		return this.providerConfigStore
	}

	getProviderCatalog(): ProviderCatalog {
		return this.providerCatalog
	}

	private handleProviderConfigChange(event: ProviderConfigChange): void {
		this.scheduleProviderConfigStatePost()

		if (event.kind === "selection" && this.isSelectionForActiveModeProvider(event)) {
			this.sessions
				?.updateActiveSessionModel(event.selection.modelId)
				.catch((error) => Logger.error("[SdkController] Failed to update active session model:", error))
		}
	}

	private isSelectionForActiveModeProvider(event: Extract<ProviderConfigChange, { kind: "selection" }>): boolean {
		try {
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode = modeValue === "plan" ? "plan" : "act"
			if (event.mode !== mode) {
				return false
			}

			const apiConfig = this.stateManager.getApiConfiguration()
			const activeProvider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
			return activeProvider === event.providerId.toString()
		} catch {
			return false
		}
	}

	private scheduleProviderConfigStatePost(): void {
		if (this.providerConfigStatePostScheduled) {
			return
		}

		this.providerConfigStatePostScheduled = true
		queueMicrotask(() => {
			this.providerConfigStatePostScheduled = false
			this.postStateToWebview().catch((error) => {
				Logger.error("[SdkController] Failed to post state after provider config change:", error)
			})
		})
	}

	/**
	 * Starts the periodic remote config fetching timer.
	 * Fetches immediately and then every hour. Mirrors the classic
	 * Controller.startRemoteConfigTimer() behavior for enterprise
	 * policy enforcement (provider lockdown, MCP server management,
	 * OpenTelemetry, etc.).
	 */
	private startRemoteConfigTimer(): void {
		// Initial fetch
		this.refreshRemoteConfig().catch((err) => Logger.error("[SdkController] Initial remote config refresh failed:", err))
		// Set up 1-hour interval
		this.remoteConfigTimer = setInterval(() => {
			this.refreshRemoteConfig().catch((err) => Logger.error("[SdkController] Remote config timer failed:", err))
		}, 3600000) // 1 hour
	}

	private async refreshRemoteConfig(): Promise<void> {
		await refreshSdkRemoteConfig(this, { workspacePath: await this.getRemoteConfigWorkspacePath() })
	}

	async setRemoteConfigCoreIntegration(integration: PreparedRemoteConfigCoreIntegration | undefined): Promise<void> {
		const previous = this.remoteConfigCoreIntegration
		this.remoteConfigCoreIntegration = integration
		if (previous && previous !== integration) {
			try {
				await previous.dispose()
			} catch (error) {
				Logger.error("[SdkController] Failed to dispose previous remote config integration:", error)
			}
		}
	}

	async dispose(): Promise<void> {
		this.providerConfigStoreSubscription.dispose()
		// Clear the remote config timer to prevent stale fetches
		if (this.remoteConfigTimer) {
			clearInterval(this.remoteConfigTimer)
			this.remoteConfigTimer = undefined
		}
		await this.setRemoteConfigCoreIntegration(undefined)
		this.messages.cancelPendingSave()
		// Clear MCP tool list change callback before disposing McpHub
		this.mcpHub?.clearToolListChangeCallback()
		await this.clearTask()
		await this.taskHistory.dispose()
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
	 * `HostProvider.workspace.getWorkspacePaths()`. If no workspace folder is
	 * open, it falls back to Desktop.
	 * This avoids using the VS Code extension host's `process.cwd()` (often `/`),
	 * which produces invalid SDK workspace metadata with an empty hint.
	 */
	private async getWorkspaceRoot(): Promise<string> {
		const noWorkspaceFallback = getDesktopDir()
		try {
			const { paths } = await HostProvider.workspace.getWorkspacePaths({})
			return resolveWorkspaceRootPath(paths, noWorkspaceFallback)
		} catch (error) {
			Logger.warn("[SdkController] Failed to get workspace paths, falling back to Desktop:", error)
		}
		return noWorkspaceFallback
	}

	private async getRemoteConfigWorkspacePath(): Promise<string | undefined> {
		try {
			const { paths } = await HostProvider.workspace.getWorkspacePaths({})
			if (!paths.length) {
				return undefined
			}
			return resolveWorkspaceRootPath(paths, paths[0])
		} catch (error) {
			Logger.warn("[SdkController] Failed to get workspace paths for remote config, using global fallback:", error)
			return undefined
		}
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
	 * Check if an error message indicates an insufficient credits / balance error
	 * by reshaping it into ClineError format and inspecting the result.
	 */
	private isClineBalanceError(errorMessage: string): boolean {
		try {
			const shaped = JSON.parse(reshapeErrorForWebview({ message: errorMessage }))
			return shaped.code === "insufficient_credits"
		} catch {
			return false
		}
	}

	/**
	 * Emit a balance error for the 'cline' provider when the user has insufficient
	 * credits. Produces the same message sequence as emitClineAuthError so the
	 * webview renders the "Buy Credits" button via CreditLimitError.
	 *
	 * Message sequence:
	 *   1. say:'api_req_started' – streamingFailedMessage holds the ClineError JSON
	 *   2. ask:'api_req_failed'  – ClineError JSON → ErrorRow renders balance UI
	 */
	private emitClineBalanceError(rawErrorMessage: string): void {
		const ts = Date.now()

		// reshapeErrorForWebview extracts structured fields from the SDK error
		// message (which may be plain text or embedded JSON) and produces the
		// ClineError-serialized JSON that the webview's ErrorRow expects.
		const serializedError = reshapeErrorForWebview({ message: rawErrorMessage })

		const messages: ClineMessage[] = [
			{
				ts,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					streamingFailedMessage: serializedError,
				} satisfies ClineApiReqInfo),
				partial: false,
			},
			{
				ts: ts + 1,
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

	// ---- Task lifecycle (Step 4) ----

	async initTask(
		prompt?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
	): Promise<string | undefined> {
		// Fire-and-forget: ensure we have the latest remote config (enterprise
		// policies like yoloModeAllowed, allowedMCPServers, etc.) without
		// blocking the UI.
		this.refreshRemoteConfig().catch((err) => Logger.error("[SdkController] Remote config refresh before task failed:", err))
		return this.taskStart.initTask(prompt, images, files, historyItem, taskSettings)
	}

	async reinitExistingTaskFromId(taskId: string): Promise<void> {
		await this.taskStart.reinitExistingTaskFromId(taskId)
	}

	async cancelTask(): Promise<void> {
		await this.taskControl.cancelTask()
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	async clearTask(): Promise<void> {
		await this.taskControl.clearTask()
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
	async showTaskWithId(taskId: string): Promise<TaskResponse> {
		const startedAt = Date.now()
		const lookupStartedAt = Date.now()
		const historyItem = await this.taskHistory.findHistoryItem(taskId)
		const lookupElapsed = Date.now() - lookupStartedAt
		if (!historyItem) {
			Logger.log(
				`[HistoryPerf] SdkController.showTaskWithId taskId=${taskId} found=false targetedLookup=${lookupElapsed}ms total=${Date.now() - startedAt}ms`,
			)
			throw new Error(`Task not found in history: ${taskId}`)
		}

		const controlStartedAt = Date.now()
		await this.taskControl.showTaskWithId(taskId, { skipHistoryLookup: true })
		Logger.log(
			`[HistoryPerf] SdkController.showTaskWithId taskId=${taskId} targetedLookup=${lookupElapsed}ms control=${Date.now() - controlStartedAt}ms total=${Date.now() - startedAt}ms`,
		)
		return historyItemToTaskResponse(historyItem)
	}

	// ---- Mode switching (Step 8) ----

	async toggleActModeForYoloMode(): Promise<boolean> {
		return this.mode.toggleActModeForYoloMode()
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		return this.mode.togglePlanActMode(modeToSwitchTo, chatContent)
	}

	// ---- Telemetry ----

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		await this.postStateToWebview()
	}

	// ---- Auth callbacks (Step 6) ----

	async handleSignOut(): Promise<void> {
		await this.authService.handleDeauth(LogoutReason.USER_INITIATED)
		clearRemoteConfig()
		await this.setRemoteConfigCoreIntegration(undefined)
		await this.postStateToWebview()
	}

	async handleOcaSignOut(): Promise<void> {
		// OCA uses the same auth service — clear Cline auth on OCA sign out
		await this.authService.handleDeauth(LogoutReason.USER_INITIATED)
		await this.postStateToWebview()
	}

	async handleAuthCallback(customToken: string, provider: string | null = null): Promise<void> {
		await this.authService.handleAuthCallback(customToken, provider ?? "cline")
		// Fetch remote config immediately after login so enterprise policies
		// (provider lockdown, MCP servers, OTel, etc.) are applied right away.
		await this.refreshRemoteConfig()
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

	private async fetchMcpMarketplaceFromApi(): Promise<McpMarketplaceCatalog> {
		const response = await axios.get(`${ClineEnv.config().mcpBaseUrl}/marketplace`, {
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "cline-vscode-extension",
			},
			...getAxiosSettings(),
		})

		if (!response.data) {
			throw new Error("Invalid response from MCP marketplace API")
		}

		const allowedMCPServers = this.stateManager.getRemoteConfigSettings().allowedMCPServers

		let items: McpMarketplaceItem[] = (response.data || []).map((item: McpMarketplaceItem) => ({
			...item,
			githubStars: item.githubStars ?? 0,
			downloadCount: item.downloadCount ?? 0,
			tags: item.tags ?? [],
		}))

		if (allowedMCPServers) {
			const allowedIds = new Set(allowedMCPServers.map((server) => server.id))
			items = items.filter((item) => allowedIds.has(item.mcpId))
		}

		const catalog: McpMarketplaceCatalog = { items }
		await writeMcpMarketplaceCatalogToCache(catalog)
		return catalog
	}

	async refreshMcpMarketplace(sendCatalogEvent: boolean): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const catalog = await this.fetchMcpMarketplaceFromApi()
			if (catalog && sendCatalogEvent) {
				await sendMcpMarketplaceCatalogEvent(catalog)
			}
			return catalog
		} catch (error) {
			Logger.error("Failed to refresh MCP marketplace:", error)
			return undefined
		}
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

	async getTaskHistory(request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
		const startedAt = Date.now()
		const { favoritesOnly, currentWorkspaceOnly, searchQuery, sortBy } = request
		const limit = request.limit > 0 ? Math.min(request.limit, 100) : 50
		const offset = request.offset > 0 ? request.offset : 0
		const workspaceStartedAt = Date.now()
		const workspacePath = currentWorkspaceOnly ? await this.getWorkspaceRoot() : undefined
		const workspaceElapsed = Date.now() - workspaceStartedAt
		const listStartedAt = Date.now()
		const sessionHistory = await this.taskHistory.listHistory({ hydrate: false, limit: limit + 1, offset })
		const listElapsed = Date.now() - listStartedAt
		const transformStartedAt = Date.now()

		let filteredTasks = sessionHistory.filter((item) => {
			const ts = dateStringToTimestamp(item.updatedAt ?? item.endedAt ?? item.startedAt)
			const task = metadataString(item.metadata, "title") ?? item.prompt ?? ""

			if (!ts || !task) {
				return false
			}

			const isFavorited =
				metadataBoolean(item.metadata, "isFavorited") ?? metadataBoolean(item.metadata, "is_favorited") ?? false
			if (favoritesOnly && !isFavorited) {
				return false
			}

			if (currentWorkspaceOnly && workspacePath) {
				const sessionWorkspacePath = item.cwd ?? item.workspaceRoot
				if (!sessionWorkspacePath || !arePathsEqual(sessionWorkspacePath, workspacePath)) {
					return false
				}
			}

			return true
		})

		if (searchQuery) {
			const query = searchQuery.toLowerCase()
			filteredTasks = filteredTasks.filter((item) => {
				const task = metadataString(item.metadata, "title") ?? item.prompt ?? ""
				return task.toLowerCase().includes(query)
			})
		}

		filteredTasks.sort((a, b) => {
			switch (sortBy) {
				case "oldest":
					return (
						dateStringToTimestamp(a.updatedAt ?? a.endedAt ?? a.startedAt) -
						dateStringToTimestamp(b.updatedAt ?? b.endedAt ?? b.startedAt)
					)
				case "mostExpensive":
					return (metadataNumber(b.metadata, "totalCost") ?? 0) - (metadataNumber(a.metadata, "totalCost") ?? 0)
				case "mostTokens":
					return (
						(metadataNumber(b.metadata, "tokensIn") ?? 0) +
						(metadataNumber(b.metadata, "tokensOut") ?? 0) +
						(metadataNumber(b.metadata, "cacheWrites") ?? 0) +
						(metadataNumber(b.metadata, "cacheReads") ?? 0) -
						((metadataNumber(a.metadata, "tokensIn") ?? 0) +
							(metadataNumber(a.metadata, "tokensOut") ?? 0) +
							(metadataNumber(a.metadata, "cacheWrites") ?? 0) +
							(metadataNumber(a.metadata, "cacheReads") ?? 0))
					)
				default:
					return (
						dateStringToTimestamp(b.updatedAt ?? b.endedAt ?? b.startedAt) -
						dateStringToTimestamp(a.updatedAt ?? a.endedAt ?? a.startedAt)
					)
			}
		})

		const hasMore = sessionHistory.length > limit
		const mapStartedAt = Date.now()
		const tasks = filteredTasks.slice(0, limit).map((item) => {
			const metadata = item.metadata
			return {
				id: item.sessionId,
				task: formatDisplayUserInput(metadataString(metadata, "title") ?? item.prompt ?? ""),
				ts: dateStringToTimestamp(item.updatedAt ?? item.endedAt ?? item.startedAt),
				isFavorited: metadataBoolean(metadata, "isFavorited") ?? metadataBoolean(metadata, "is_favorited") ?? false,
				size: metadataNumber(metadata, "size") ?? 0,
				totalCost: metadataNumber(metadata, "totalCost") ?? 0,
				tokensIn: metadataNumber(metadata, "tokensIn") ?? 0,
				tokensOut: metadataNumber(metadata, "tokensOut") ?? 0,
				cacheWrites: metadataNumber(metadata, "cacheWrites") ?? 0,
				cacheReads: metadataNumber(metadata, "cacheReads") ?? 0,
				modelId: item.model || metadataString(metadata, "modelId") || "",
			}
		})

		Logger.log(
			`[HistoryPerf] SdkController.getTaskHistory offset=${offset} limit=${limit} raw=${sessionHistory.length} filtered=${filteredTasks.length} tasks=${tasks.length} hasMore=${hasMore} workspace=${workspaceElapsed}ms list=${listElapsed}ms filterSortMap=${Date.now() - transformStartedAt}ms map=${Date.now() - mapStartedAt}ms total=${Date.now() - startedAt}ms`,
		)
		return TaskHistoryArray.create({ tasks, hasMore })
	}

	async exportTaskWithId(id: string): Promise<void> {
		const historyItem = (await this.taskHistory.listHistory({ hydrate: false })).find((item) => item.sessionId === id)
		if (!historyItem) {
			throw new Error(`Task not found in history: ${id}`)
		}

		// SDK-backed tasks are no longer stored under VS Code's globalStorageFsPath/tasks.
		// The SDK owns session persistence and exposes the persisted messages artifact path
		// on the session history record; open that artifact's containing session directory.
		const taskDirPath = historyItem.messagesPath ? path.dirname(historyItem.messagesPath) : undefined
		if (!taskDirPath) {
			throw new Error(`Task history item has no SDK artifact path: ${id}`)
		}

		await fs.access(taskDirPath)
		Logger.log(`[EXPORT] Opening SDK task directory: ${taskDirPath}`)
		const open = (await import("open")).default
		await open(taskDirPath)
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		return this.taskHistory.deleteTaskFromState(id)
	}

	async deleteAllTaskHistory(): Promise<DeleteAllTaskHistoryCount> {
		await this.clearTask()

		const taskHistory = await this.taskHistory.listHistory({ hydrate: false })
		const totalTasks = taskHistory.length

		const userChoice = (
			await HostProvider.window.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.WARNING,
					message: "What would you like to delete?",
					options: {
						modal: true,
						items: ["Delete All Except Favorites", "Delete Everything"],
					},
				}),
			)
		).selectedOption

		if (userChoice === undefined) {
			return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
		}

		if (userChoice === "Delete All Except Favorites") {
			const hasFavoritedTasks = taskHistory.some(
				(task) =>
					metadataBoolean(task.metadata, "isFavorited") ?? metadataBoolean(task.metadata, "is_favorited") ?? false,
			)

			if (hasFavoritedTasks) {
				const tasksDeleted = await this.taskHistory.deleteAllTaskHistory({ preserveFavorites: true })
				await this.postStateToWebview()
				return DeleteAllTaskHistoryCount.create({ tasksDeleted })
			}

			const answer = (
				await HostProvider.window.showMessage({
					type: ShowMessageType.WARNING,
					message: "No favorited tasks found. Would you like to delete all tasks anyway?",
					options: {
						modal: true,
						items: ["Delete All Tasks"],
					},
				})
			).selectedOption

			if (answer === undefined) {
				return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
			}
		}

		const tasksDeleted = await this.taskHistory.deleteAllTaskHistory()
		await this.postStateToWebview()
		return DeleteAllTaskHistoryCount.create({ tasksDeleted: tasksDeleted || totalTasks })
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		return this.taskHistory.updateTaskHistory(item)
	}

	async toggleTaskFavorite(taskId: string, isFavorited: boolean): Promise<void> {
		const historyItem = await this.taskHistory.findHistoryItem(taskId)
		if (!historyItem) {
			Logger.log(`[toggleTaskFavorite] Task not found in history: ${taskId}`)
			return
		}

		await this.taskHistory.updateTaskHistory({
			...historyItem,
			isFavorited,
		})
		await this.postStateToWebview()
	}

	// ---- Background command state ----

	updateBackgroundCommandState(running: boolean, taskId?: string): void {
		this.backgroundCommandRunning = running
		this.backgroundCommandTaskId = taskId
	}

	// ---- State management ----

	async postStateToWebview(): Promise<void> {
		const startedAt = Date.now()
		// Import dynamically to avoid circular deps
		const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
		const stateStartedAt = Date.now()
		const state = await this.getStateToPostToWebview()
		const stateElapsed = Date.now() - stateStartedAt
		const sendStartedAt = Date.now()
		await sendStateUpdate(state)
		Logger.log(
			`[HistoryPerf] SdkController.postStateToWebview state=${stateElapsed}ms send=${Date.now() - sendStartedAt}ms total=${Date.now() - startedAt}ms`,
		)
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Delegate to the classic implementation which reads from StateManager.
		// This will be gradually replaced with SDK-sourced state in later Steps
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
			const historyStartedAt = Date.now()
			const sdkTaskHistory = (await this.taskHistory.listHistory({ limit: 100, hydrate: false }))
				.map(sessionHistoryRecordToHistoryItem)
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
			const historyElapsed = Date.now() - historyStartedAt
			if (historyElapsed > 250) {
				Logger.warn(`[SdkController] fast listSdkTaskHistory during state build took ${historyElapsed}ms`)
			}
			const classicTaskHistory = state.taskHistory ?? []
			const mergedTaskHistoryById = new Map<string, HistoryItem>()

			// Keep the SDK records authoritative for migrated/new tasks, but append
			// classic persisted history so pre-migration tasks still appear in the UI.
			for (const item of classicTaskHistory) {
				mergedTaskHistoryById.set(item.id, item)
			}
			for (const item of sdkTaskHistory) {
				mergedTaskHistoryById.set(item.id, item)
			}

			const processedTaskHistory = Array.from(mergedTaskHistoryById.values())
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
				.slice(0, 100)

			return {
				...state,
				currentTaskItem: this.task?.taskId
					? processedTaskHistory.find((item) => item.id === this.task?.taskId)
					: undefined,
				taskHistory: processedTaskHistory,
			}
		} catch (error) {
			Logger.error("[SdkController] Failed to get state for webview:", error)
			throw error
		}
	}

	// ---- Terminal settings ----

	/**
	 * Apply the user's terminal settings from StateManager to a terminal manager.
	 * Called once when the lazy terminal manager is first created, and can be
	 * called again when settings change at runtime.
	 */
	applyTerminalSettings(terminalManager: ITerminalManager): void {
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		if (shellIntegrationTimeout !== undefined) {
			terminalManager.setShellIntegrationTimeout(Number(shellIntegrationTimeout))
		}

		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		if (terminalReuseEnabled !== undefined) {
			terminalManager.setTerminalReuseEnabled(!!terminalReuseEnabled)
		}

		const terminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		if (terminalOutputLineLimit !== undefined) {
			terminalManager.setTerminalOutputLineLimit(Number(terminalOutputLineLimit))
		}

		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		if (defaultTerminalProfile !== undefined && defaultTerminalProfile !== "") {
			terminalManager.setDefaultTerminalProfile(String(defaultTerminalProfile))
		}

		Logger.log(
			`[SdkController] Applied terminal settings: profile=${defaultTerminalProfile ?? "default"}, ` +
				`timeout=${shellIntegrationTimeout ?? 4000}, reuse=${terminalReuseEnabled ?? true}, ` +
				`outputLimit=${terminalOutputLineLimit ?? 500}`,
		)
	}

	/**
	 * Get the terminal manager instance (if created).
	 * Used by updateSettings handlers to apply runtime changes.
	 */
	get terminalManager(): ITerminalManager | undefined {
		return this._terminalManager
	}

	// ---- Workspace (kept from classic) ----

	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		stubWarn("ensureWorkspaceManager")
		return undefined
	}
}
