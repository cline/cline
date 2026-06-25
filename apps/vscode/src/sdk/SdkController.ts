// Replaces classic src/core/controller/index.ts (see origin/main)
//
// The SDK-backed Controller. It provides the same interface as the classic
// Controller but delegates session lifecycle (initTask, askResponse,
// cancelTask, …) to the Cline SDK (@cline/core) and bridges SDK events to
// the webview's gRPC streams.
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
	createUserInstructionConfigService,
	getProviderAuthStorageId,
	type PreparedRemoteConfigCoreIntegration,
	type SessionHistoryRecord,
	setTelemetryOptOutGlobally,
	type UserInstructionConfigService,
} from "@cline/core"
import { formatDisplayUserInput, type RemoteConfig, type RemoteConfigBundle } from "@cline/shared"
import type { ApiConfiguration, ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import { mentionRegexGlobal } from "@shared/context-mentions"
import type { ClineApiReqInfo, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { DeleteAllTaskHistoryCount, type GetTaskHistoryRequest, TaskHistoryArray, TaskResponse } from "@shared/proto/cline/task"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { parseMentions } from "@/core/mentions"
import { ensureMcpServersDirectoryExists } from "@/core/storage/disk"
import { refreshSdkRemoteConfig } from "@/core/storage/remote-config/sdk-refresh"
import { clearRemoteConfig } from "@/core/storage/remote-config/utils"
import { StateManager } from "@/core/storage/StateManager"
import type { WorkspaceRootManager } from "@/core/workspace/WorkspaceRootManager"
import { HostProvider } from "@/hosts/host-provider"
import type { ITerminalManager } from "@/integrations/terminal/types"
import { ExtensionRegistryInfo } from "@/registry"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { UrlContentFetcher } from "@/services/browser/UrlContentFetcher"
import { ClineError } from "@/services/error/ClineError"
import { McpHub } from "@/services/mcp/McpHub"
import { telemetryService } from "@/services/telemetry"
import type { ClineExtensionContext } from "@/shared/cline"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { arePathsEqual, getDesktopDir } from "@/utils/path"
import { ClineAccountService } from "./account-service"
import { AuthService, LogoutReason } from "./auth-service"
import { buildStartSessionInput, createHistoryItemFromSession } from "./cline-session-factory"
import { MessageTranslatorState, reshapeErrorForWebview } from "./message-translator"
import { createProviderCatalog } from "./model-catalog/catalog"
import type { Disposable, ProviderCatalog, ProviderConfigChange, ProviderConfigStore } from "./model-catalog/contracts"
import { parseProviderId } from "./model-catalog/provider-id"
import { createProviderConfigStore } from "./model-catalog/store"
import { SdkFollowupCoordinator } from "./sdk-followup-coordinator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMcpCoordinator } from "./sdk-mcp-coordinator"
import { SdkMessageCoordinator, type SessionEventListener } from "./sdk-message-coordinator"
import { SdkModeCoordinator } from "./sdk-mode-coordinator"
import { SdkProviderChangeCoordinator } from "./sdk-provider-change-coordinator"
import { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import { SdkSessionEventCoordinator } from "./sdk-session-event-coordinator"
import { SdkSessionHistoryLoader } from "./sdk-session-history-loader"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { SdkTaskControlCoordinator } from "./sdk-task-control-coordinator"
import { SdkTaskHistory, sessionHistoryRecordToHistoryItem } from "./sdk-task-history"
import { SdkTaskStartCoordinator } from "./sdk-task-start-coordinator"
import { createVscodeSdkTelemetryHandle, type VscodeSdkTelemetryHandle } from "./sdk-telemetry"
import { isToolAutoApproved } from "./sdk-tool-policies"
import {
	extractSdkUserText,
	findSdkUserMessageIndexByOrdinal,
	isSyntheticSdkUserMessage,
	type SdkUserMessage,
} from "./sdk-user-message-mapping"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import { syncTelemetrySettingFromSharedGlobalSettings } from "./telemetry-settings-sync"
import { TurnStateTracker } from "./turn-state-tracker"
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

function usesClineAccountAuth(providerId: string): boolean {
	return getProviderAuthStorageId(providerId) === "cline"
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
	// SDK session state and the coordinators that drive it.
	private messageTranslatorState: MessageTranslatorState
	private turnStateTracker!: TurnStateTracker
	private messages: SdkMessageCoordinator
	private sessions: SdkSessionLifecycle
	private interactions: SdkInteractionCoordinator
	private sessionConfigBuilder: SdkSessionConfigBuilder
	private taskHistory: SdkTaskHistory
	private mode: SdkModeCoordinator
	private mcpTools: SdkMcpCoordinator
	private providerChanges: SdkProviderChangeCoordinator
	private followups: SdkFollowupCoordinator
	private taskControl: SdkTaskControlCoordinator
	private taskStart: SdkTaskStartCoordinator
	private sessionEvents: SdkSessionEventCoordinator
	private sessionHistory: SdkSessionHistoryLoader
	private readonly sdkTelemetry: VscodeSdkTelemetryHandle
	private readonly providerConfigStore: ProviderConfigStore
	private readonly providerCatalog: ProviderCatalog
	private readonly providerConfigStoreSubscription: Disposable
	private providerConfigStatePostScheduled = false

	// Bridges SDK events to the webview's gRPC streams.
	private grpcBridge: WebviewGrpcBridge

	// Presents the Task interface that gRPC handlers expect, delegating to the
	// active SDK session.
	task?: TaskProxy

	mcpHub: McpHub
	accountService: ClineAccountService
	authService: AuthService
	ocaAuthService: OcaAuthService
	readonly stateManager: StateManager

	// Lazy terminal manager for foreground terminal execution.
	// Concrete impl comes from HostProvider (VscodeTerminalManager in VSCode,
	// StandaloneTerminalManager in cline-core / JetBrains).
	// Created on first use; shared across all sessions in this Controller's lifetime.
	private _terminalManager?: ITerminalManager

	// Private state kept for stub compatibility
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string
	private pendingClineAuthRetryPrompt?: string

	// Timer for periodic remote config fetching (enterprise policy enforcement)
	private remoteConfigTimer?: NodeJS.Timeout
	private remoteConfigCoreIntegration?: PreparedRemoteConfigCoreIntegration

	// Watches user-instruction files (workflows/skills/rules), including those
	// materialized by remote config under `.cline/remote-config/`. Used to expand
	// `/workflow` and `/skill` slash commands into their instruction bodies before
	// the prompt reaches the model — the same mechanism the CLI uses in
	// `buildUserInputMessage`. The agent loop never auto-expands commands, so this
	// host-side expansion is required. Created lazily (memoized as a promise to be
	// race-free under concurrent first sends) and rebuilt if the workspace root
	// changes.
	private userInstructionService?: Promise<UserInstructionConfigService>
	private userInstructionServiceRoot?: string
	private isDisposed = false

	get remoteConfig(): RemoteConfig | undefined {
		return this.remoteConfigCoreIntegration?.prepared.bundle?.remoteConfig
	}

	get remoteConfigBundle(): RemoteConfigBundle | undefined {
		return this.remoteConfigCoreIntegration?.prepared.bundle
	}

	constructor(readonly context: ClineExtensionContext) {
		// StateManager must be initialized before creating the Controller
		this.stateManager = StateManager.get()
		syncTelemetrySettingFromSharedGlobalSettings(this.stateManager)
		this.sdkTelemetry = createVscodeSdkTelemetryHandle()
		this.providerConfigStore = createProviderConfigStore()
		this.providerCatalog = createProviderCatalog(this.providerConfigStore)
		this.providerConfigStoreSubscription = this.providerConfigStore.subscribe((event) => {
			this.handleProviderConfigChange(event)
		})

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

		// Initialize SDK-backed auth and account services.
		this.authService = AuthService.getInstance(this)
		this.ocaAuthService = OcaAuthService.initialize(this)
		this.accountService = ClineAccountService.getInstance()

		// Initialize message translator state
		this.messageTranslatorState = new MessageTranslatorState(undefined, () => this.getActiveProviderId())
		// Authoritative UI-mode tracker, sharing the one id/seq/epoch authority.
		this.turnStateTracker = new TurnStateTracker(this.messageTranslatorState.getMinter())
		this.messages = new SdkMessageCoordinator({
			getTask: () => this.task,
			// Stamp seq/epoch on every message flowing to the webview from the shared authority.
			getMinter: () => this.messageTranslatorState.getMinter(),
		})
		this.sessionHistory = new SdkSessionHistoryLoader()
		this.sessionConfigBuilder = new SdkSessionConfigBuilder({
			stateManager: this.stateManager,
			emitHookMessage: (msg) => this.messages.emitHookMessage(msg),
			onSwitchToActMode: () => {
				this.mode.queueSwitchToActMode()
			},
			shouldStopAfterModeSwitch: () => this.mode.hasPendingModeChange(),
			onConsecutiveMistakeLimitReached: (context) => this.interactions.handleConsecutiveMistakeLimitReached(context),
		})
		this.interactions = new SdkInteractionCoordinator({
			messages: this.messages,
			getSessionId: () => this.sessions.getActiveSession()?.sessionId ?? "",
			postStateToWebview: () => this.postStateToWebview(),
			// Share the single id/seq/epoch authority so interaction-minted ids (tool-approval
			// asks, ask_question, user_feedback) never collide with translator-minted ids.
			getMinter: () => this.messageTranslatorState.getMinter(),
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			recordApprovedToolMessage: (toolCallId, messageTs) =>
				this.messageTranslatorState.recordApprovedToolMessageTs(toolCallId, messageTs),
			recordDeniedToolApproval: (toolCallId, toolName, reason) =>
				this.messageTranslatorState.recordDeniedToolApproval(toolCallId, toolName, reason),
			shouldAutoApproveTool: (request) => {
				const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
				return autoApprovalSettings ? isToolAutoApproved(request.toolName, autoApprovalSettings, this.mcpHub) : false
			},
		})
		this.sessions = new SdkSessionLifecycle({
			mcpHub: this.mcpHub,
			telemetry: this.sdkTelemetry.telemetry,
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
				await this.providerChanges.handleTurnComplete(this.mode)

				this.postStateToWebview().catch((err) => {
					Logger.error("[SdkController] Failed to post state after turn:", err)
				})
			},
			onSendError: async (error, sessionId) => {
				// A turn failed — the UI shows error recovery (Retry / Sign In / Add Credits).
				this.turnStateTracker.set("error")
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
			legacyExtensionStorageDir: this.context.globalStorageUri.fsPath,
			telemetry: telemetryService,
			// History rendering mints ids from the shared authority so regenerated history ids
			// never overlap live-session ids.
			getMinter: () => this.messageTranslatorState.getMinter(),
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
			resetMessageTranslator: () => this.resetMessageTranslatorAndFence(),
			postStateToWebview: () => this.postStateToWebview(),
			getTurnPhase: () => this.turnStateTracker.currentPhase,
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			onAutoContinueStarting: () => {
				this.turnStateTracker.set("streaming")
				this.messageTranslatorState.clearTurnOutcome()
			},
			onAutoContinueFailed: () => {
				this.turnStateTracker.set("error")
			},
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
		this.providerChanges = new SdkProviderChangeCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getTask: () => this.task,
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
			waitForPendingModeRebuild: () => this.mode.waitForPendingRebuild(),
			getTask: () => this.task,
			createTempSessionHost: () => VscodeSessionHost.create({ mcpHub: this.mcpHub }),
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: (sessionHost, taskId) => this.sessionHistory.loadInitialMessages(sessionHost, taskId),
			buildStartSessionInput,
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			isClineProviderActive: () => this.isClineProviderActive(),
			emitClineAuthError: () => this.emitClineAuthError(),
			resetMessageTranslator: () => this.resetMessageTranslatorAndFence(),
			postStateToWebview: () => this.postStateToWebview(),
			onResumeFailed: () => {
				this.turnStateTracker.set("error")
			},
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
			resetMessageTranslator: () => this.resetMessageTranslatorAndFence(),
			// Bump the epoch synchronously before abort so straggler events from the cancelled
			// turn carry the old epoch and are dropped by the webview. The resumable phase is set
			// in SdkController.cancelTask before this runs.
			raiseCancelFence: () => {
				this.messageTranslatorState.clearApprovedToolMessageTs()
				this.messageTranslatorState.getMinter().bumpEpoch()
			},
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
			clearTask: async () => {
				this.pendingClineAuthRetryPrompt = undefined
				await this.taskControl.clearTask()
			},
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
			providerChanges: this.providerChanges,
			mode: this.mode,
			taskHistory: this.taskHistory,
			stateManager: this.stateManager,
			getTask: () => this.task,
			postStateToWebview: () => this.postStateToWebview(),
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
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

	invalidateProviderListings(): void {
		this.providerCatalog.invalidateProviderListings()
	}

	private handleProviderConfigChange(event: ProviderConfigChange): void {
		this.scheduleProviderConfigStatePost()

		if (event.kind === "selection" && this.isSelectionForActiveModeProvider(event)) {
			this.sessions
				?.updateActiveSessionModel(event.selection.modelId)
				.catch((error) => Logger.error("[SdkController] Failed to update active session model:", error))
		}
	}

	handleApiConfigurationChanged(previous: ApiConfiguration, next: ApiConfiguration): void {
		this.providerChanges.handleApiConfigurationChanged(previous, next)
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
	 * Starts the periodic remote config fetching timer. Fetches immediately
	 * and then every hour, to enforce enterprise policy (provider lockdown,
	 * MCP server management, OpenTelemetry, etc.).
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
		await refreshSdkRemoteConfig(this, {
			workspacePath: await this.getRemoteConfigWorkspacePath(),
		})
		// Remote config may have materialized new workflows/skills/rules under
		// `.cline/remote-config/`. Refresh the watcher so slash-command expansion
		// sees them without waiting on filesystem events.
		await this.refreshUserInstructionWatchers()
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
		this.isDisposed = true
		const userInstructionServicePromise = this.userInstructionService
		this.userInstructionService = undefined
		if (userInstructionServicePromise) {
			await userInstructionServicePromise.then((service) => service.stop()).catch(() => {})
		}
		this.messages.cancelPendingSave()
		// Clear MCP tool list change callback before disposing McpHub
		this.mcpHub?.clearToolListChangeCallback()
		await this.clearTask()
		await this.sessions.dispose("SdkController.dispose")
		await this.taskHistory.dispose()
		this.mcpHub?.dispose?.()
		this.messages.dispose()
		await this.sdkTelemetry.dispose()
		Logger.log("[SdkController] Disposed")
	}

	// ---- Slash command + context mention resolution ----

	/**
	 * Lazily create (or rebuild on workspace-root change) the user-instruction
	 * watcher. Pointed at the workspace root so it discovers both local config
	 * (`.clinerules/workflows`, `.cline/workflows`, …) and remote-config files
	 * materialized under `<root>/.cline/remote-config/{workflows,skills,rules}`.
	 *
	 * `workspaceRoot` is resolved by the caller so the memoization check below runs
	 * synchronously on entry — there is no `await` before the assignment, so
	 * concurrent callers cannot create two competing watchers.
	 */
	private ensureUserInstructionService(workspaceRoot: string): Promise<UserInstructionConfigService> {
		// dispose() may have run during an awaited gap in the caller. Don't
		// resurrect a watcher the dispose path will never stop again.
		if (this.isDisposed) {
			return Promise.reject(new Error("Controller disposed"))
		}
		if (this.userInstructionService && this.userInstructionServiceRoot === workspaceRoot) {
			return this.userInstructionService
		}
		// Workspace root changed: stop the previous watcher once it settles.
		const previous = this.userInstructionService
		if (previous) {
			previous.then((service) => service.stop()).catch(() => {})
		}
		this.userInstructionServiceRoot = workspaceRoot
		this.userInstructionService = (async () => {
			const service = createUserInstructionConfigService({
				workflows: { workspacePath: workspaceRoot },
				skills: { workspacePath: workspaceRoot },
				rules: { workspacePath: workspaceRoot },
			})
			// start() runs the initial scan; await so the snapshot is populated
			// before the first resolveRuntimeSlashCommand call.
			await service.start().catch((error) => {
				Logger.warn("[SdkController] Failed to start user instruction watcher:", error)
			})
			return service
		})()
		return this.userInstructionService
	}

	/**
	 * Expand a leading `/workflow` or `/skill` slash command into its instruction
	 * body. Mirrors the CLI's `buildUserInputMessage`. Returns the input unchanged
	 * if it is not a known command or expansion fails.
	 */
	private async resolveSlashCommands(text: string): Promise<string> {
		if (this.isDisposed) {
			return text
		}
		try {
			const workspaceRoot = await this.getWorkspaceRoot()
			const service = await this.ensureUserInstructionService(workspaceRoot)
			return service.resolveRuntimeSlashCommand(text)
		} catch (error) {
			Logger.warn("[SdkController] Slash command resolution failed, using raw text:", error)
			return text
		}
	}

	/**
	 * Refresh the user-instruction watcher after remote config is (re)materialized
	 * so newly written workflows/skills/rules are picked up immediately rather than
	 * waiting on filesystem watch events.
	 */
	private async refreshUserInstructionWatchers(): Promise<void> {
		const servicePromise = this.userInstructionService
		if (!servicePromise) {
			return
		}
		try {
			const service = await servicePromise
			await Promise.all([service.refreshType("workflow"), service.refreshType("skill"), service.refreshType("rule")])
		} catch (error) {
			Logger.warn("[SdkController] Failed to refresh user instruction watchers:", error)
		}
	}

	/**
	 * Expand slash commands, then resolve `@` context mentions in user text
	 * before sending to the SDK.
	 *
	 * `parseMentions()` inlines file content (`@/path`), URL content
	 * (`@https://...`), diagnostics (`@problems`), git state (`@git-changes`),
	 * and commit info (`@hash`) into the prompt text. We do this here because
	 * the SDK's own mention enricher only handles simple `@path` file mentions
	 * and does not understand the webview's `@/path` format or special
	 * mentions, so the LLM would otherwise never see the referenced content.
	 */
	private async resolveContextMentions(text: string): Promise<string> {
		const withCommands = await this.resolveSlashCommands(text)

		// Quick check: skip mention parsing if there are no @ mentions
		if (!mentionRegexGlobal.test(withCommands)) {
			return withCommands
		}
		// Reset lastIndex since RegExp.test() advances it for global regexes
		mentionRegexGlobal.lastIndex = 0

		try {
			const cwd = await this.getWorkspaceRoot()
			const urlContentFetcher = new UrlContentFetcher()
			const workspaceManager = await this.ensureWorkspaceManager()
			const resolved = await parseMentions(withCommands, cwd, urlContentFetcher, undefined, workspaceManager)
			Logger.log(`[SdkController] Resolved context mentions (${withCommands.length} → ${resolved.length} chars)`)
			return resolved
		} catch (error) {
			Logger.error("[SdkController] Failed to resolve context mentions, using raw text:", error)
			return withCommands
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
	 * Get the active API provider for the current mode.
	 */
	private getActiveProviderId(): string | undefined {
		try {
			const apiConfig = this.stateManager.getApiConfiguration()
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode = modeValue === "plan" ? "plan" : "act"
			return mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		} catch {
			return undefined
		}
	}

	/**
	 * Check if the active API provider is 'cline' (for current mode).
	 */
	private isClineProviderActive(): boolean {
		return this.getActiveProviderId() === "cline"
	}

	/**
	 * Emit a proper auth error for the 'cline' provider when the user is not
	 * logged in. The message sequence drives ErrorRow to render the
	 * "Sign in to Cline" button.
	 *
	 * Message sequence:
	 *   1. say:'task'           – the user's message text
	 *   2. say:'api_req_started' – opens the API request row
	 *   3. ask:'api_req_failed'  – ClineError JSON → ErrorRow renders auth UI
	 */
	private emitClineAuthError(task?: string): void {
		const ts = Date.now()
		this.pendingClineAuthRetryPrompt = task

		if (!this.task) {
			this.task = createTaskProxy(
				`auth-error-${ts}`,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)
		}

		const clineError = new ClineError(
			{ message: CLINE_ACCOUNT_AUTH_ERROR_MESSAGE, status: 401 },
			undefined, // modelId
			"cline",
		)
		const serializedError = clineError.serialize()

		const failedAskTs = ts + 2
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
				ts: failedAskTs,
				type: "ask",
				ask: "api_req_failed",
				text: serializedError,
				partial: false,
			},
		]

		this.turnStateTracker.set("error", failedAskTs)

		this.messages.appendAndEmit(messages, {
			type: "status",
			payload: {
				sessionId: this.sessions.getActiveSession()?.sessionId ?? "",
				status: "error",
			},
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
		const serializedError = reshapeErrorForWebview({
			message: rawErrorMessage,
		})

		const failedAskTs = ts + 1
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
				ts: failedAskTs,
				type: "ask",
				ask: "api_req_failed",
				text: serializedError,
				partial: false,
			},
		]

		this.turnStateTracker.set("error", failedAskTs)

		this.messages.appendAndEmit(messages, {
			type: "status",
			payload: {
				sessionId: this.sessions.getActiveSession()?.sessionId ?? "",
				status: "error",
			},
		})

		this.postStateToWebview().catch(() => {})
	}

	// ---- Task lifecycle ----

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
		// A new task is starting — the agent is about to stream.
		this.turnStateTracker.set("streaming")
		// Clear the previous turn's completion signal so this turn's phase is computed fresh.
		this.messageTranslatorState.clearTurnOutcome()
		return this.taskStart.initTask(prompt, images, files, historyItem, taskSettings)
	}

	async reinitExistingTaskFromId(taskId: string): Promise<void> {
		this.turnStateTracker.set("streaming")
		this.messageTranslatorState.clearTurnOutcome()
		await this.taskStart.reinitExistingTaskFromId(taskId)
	}

	async cancelTask(): Promise<void> {
		// Fence first: mark resumable before aborting so any straggler events from the aborted
		// turn land on the wrong side of the UI mode. (Full fence-before-abort epoch bump lands
		// in S6; this sets the authoritative phase now.)
		this.turnStateTracker.set("resumable")
		await this.taskControl.cancelTask()
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	async clearTask(): Promise<void> {
		this.pendingClineAuthRetryPrompt = undefined
		// No active task — UI returns to idle (input enabled, no buttons/thinking).
		this.turnStateTracker.set("idle")
		await this.taskControl.clearTask()
		await this.postStateToWebview()
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
		if (this.pendingClineAuthRetryPrompt !== undefined && this.task?.taskState?.askResponse === "yesButtonClicked") {
			const retryPrompt = this.pendingClineAuthRetryPrompt
			this.pendingClineAuthRetryPrompt = undefined
			await this.initTask(retryPrompt, images, files)
			return
		}

		// Answering an ask / continuing after completion / resuming a cancelled task all kick off a
		// new agent turn — move the authoritative phase to "streaming" so the footer shows
		// Thinking + Cancel (and not the stale resumable/completed/awaiting_followup buttons or the
		// scroll-arrow default). Mirrors initTask(). The webview gates turnState by seq, and the
		// session-event coordinator will set the terminal phase (completed/awaiting_followup/error)
		// when this turn ends.
		this.turnStateTracker.set("streaming")
		// Clear the previous turn's completion signal so this new turn's phase is computed fresh.
		this.messageTranslatorState.clearTurnOutcome()
		await this.followups.askResponse(prompt, images, files, this.task?.taskState?.askResponse)
	}

	async editMessageAndRegenerate(input: {
		messageTs: number
		text: string
		images?: string[]
		files?: string[]
		restoreWorkspace?: boolean
	}): Promise<void> {
		const editedText = input.text.trim()
		if (!editedText && (input.images?.length ?? 0) === 0 && (input.files?.length ?? 0) === 0) {
			throw new Error("Edited message cannot be empty")
		}

		const activeSession = this.sessions.getActiveSession()
		const currentTask = this.task
		if (!currentTask) {
			throw new Error("No active task to edit")
		}

		const clineMessages = currentTask.messageStateHandler.getClineMessages()
		const targetIndex = clineMessages.findIndex((message) => message.ts === input.messageTs)
		if (targetIndex === -1) {
			throw new Error("Message to edit was not found")
		}
		const targetMessage = clineMessages[targetIndex]
		if (targetMessage.type !== "say" || (targetMessage.say !== "task" && targetMessage.say !== "user_feedback")) {
			throw new Error("Only user messages can be edited")
		}

		if (input.restoreWorkspace) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Workspace restore is not available for edited-message regeneration yet. Regenerating chat only.",
			})
		}

		const userOrdinal = clineMessages
			.slice(0, targetIndex + 1)
			.filter((message) => message.type === "say" && (message.say === "task" || message.say === "user_feedback")).length

		let sdkMessages: SdkUserMessage[]
		if (activeSession) {
			sdkMessages = (await activeSession.sdkHost.readMessages(activeSession.sessionId)) as SdkUserMessage[]
		} else {
			const tempHost = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
			try {
				sdkMessages = (await tempHost.readMessages(currentTask.taskId)) as SdkUserMessage[]
			} finally {
				await tempHost.dispose("editMessageAndRegenerate.readMessages")
			}
		}
		const sdkTargetIndex = findSdkUserMessageIndexByOrdinal(sdkMessages, userOrdinal)
		if (sdkTargetIndex === -1) {
			throw new Error("Could not map edited message to persisted conversation history")
		}

		const initialMessages = sdkMessages.slice(0, sdkTargetIndex) as Parameters<
			VscodeSessionHost["start"]
		>[0]["initialMessages"]
		const firstUserMessage = sdkMessages.find(
			(message) => message.role === "user" && !!extractSdkUserText(message) && !isSyntheticSdkUserMessage(message),
		)
		const historyTitle =
			userOrdinal === 1 ? editedText : extractSdkUserText(firstUserMessage ?? {}) || clineMessages[0]?.text || editedText
		const cwd = await this.getWorkspaceRoot()
		const mode = this.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		const config = await this.sessionConfigBuilder.build({ cwd, mode, prompt: historyTitle })
		if (usesClineAccountAuth(config.providerId) && !config.apiKey) {
			this.emitClineAuthError(editedText)
			return
		}

		this.turnStateTracker.set("streaming")
		this.messageTranslatorState.clearTurnOutcome()
		this.resetMessageTranslatorAndFence()

		const startInput = {
			...buildStartSessionInput(config, { prompt: historyTitle, cwd, mode }),
			initialMessages,
			sessionMetadata: {
				title: historyTitle,
				modelId: config.modelId,
			},
		}
		const { startResult, sdkHost } = await this.sessions.startNewSession(startInput)
		const task = createTaskProxy(
			startResult.sessionId,
			(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
			() => this.cancelTask(),
		)
		this.task = task

		const newHistoryItem = createHistoryItemFromSession(startResult.sessionId, historyTitle, config.modelId, cwd)
		await this.taskHistory.updateTaskHistoryItem(newHistoryItem)

		const visibleMessages = clineMessages.slice(0, targetIndex)
		if (visibleMessages.length > 0) {
			task.messageStateHandler.addMessages(visibleMessages)
		}
		task.messageStateHandler.addMessages([
			{
				ts: Date.now(),
				type: "say",
				say: userOrdinal === 1 ? "task" : "user_feedback",
				text: editedText,
				images: input.images,
				files: input.files,
				partial: false,
			},
		])
		await this.postStateToWebview()

		const resolvedPrompt = await this.resolveContextMentions(editedText)
		this.sessions.fireAndForgetSend(sdkHost, startResult.sessionId, resolvedPrompt, input.images, input.files)
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
		const historyItem = await this.taskHistory.findHistoryItem(taskId)
		if (!historyItem) {
			throw new Error(`Task not found in history: ${taskId}`)
		}

		await this.taskControl.showTaskWithId(taskId, { skipHistoryLookup: true })
		return historyItemToTaskResponse(historyItem)
	}

	// ---- Mode switching ----

	async toggleActModeForYoloMode(): Promise<boolean> {
		return this.mode.toggleActModeForYoloMode()
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		return this.mode.togglePlanActMode(modeToSwitchTo, chatContent)
	}

	// ---- Telemetry ----

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		setTelemetryOptOutGlobally(telemetrySetting === "disabled", { telemetry: this.sdkTelemetry.telemetry })
		// Mirror to StateManager for existing VS Code services during the transition.
		this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		await this.postStateToWebview()
	}

	// ---- Auth callbacks ----

	async handleSignOut(): Promise<void> {
		await this.authService.handleDeauth(LogoutReason.USER_INITIATED)
		clearRemoteConfig()
		await this.setRemoteConfigCoreIntegration(undefined)
		await this.postStateToWebview()
	}

	async handleOcaSignOut(): Promise<void> {
		await this.ocaAuthService.handleDeauth(LogoutReason.USER_INITIATED)
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
		await this.ocaAuthService.handleAuthCallback(code, state)
		await this.postStateToWebview()
	}

	// ---- Provider auth callbacks ----

	private persistProviderApiKeyFromState(provider: string): void {
		const providerId = parseProviderId(provider)
		const apiKey = this.providerConfigStore.read(providerId).apiKey

		if (!apiKey) {
			Logger.warn(`[SdkController] No API key found after ${provider} auth callback`)
			return
		}

		this.providerConfigStore.write(providerId, { apiKey })
	}

	async handleOpenRouterCallback(code: string): Promise<void> {
		await this.authService.handleOpenRouterCallback(code)
		this.persistProviderApiKeyFromState("openrouter")
		await this.postStateToWebview()
	}

	async handleRequestyCallback(code: string): Promise<void> {
		await this.authService.handleRequestyCallback(code)
		this.persistProviderApiKeyFromState("requesty")
		await this.postStateToWebview()
	}

	async handleHicapCallback(code: string): Promise<void> {
		await this.authService.handleHicapCallback(code)
		this.persistProviderApiKeyFromState("hicap")
		await this.postStateToWebview()
	}

	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		stubWarn("readOpenRouterModels")
		return undefined
	}

	async getTaskHistory(request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
		const { favoritesOnly, currentWorkspaceOnly, searchQuery, sortBy } = request
		const limit = request.limit > 0 ? Math.min(request.limit, 100) : 50
		const offset = request.offset > 0 ? request.offset : 0
		const workspacePath = currentWorkspaceOnly ? await this.getWorkspaceRoot() : undefined
		const sessionHistory = await this.taskHistory.listHistory({
			hydrate: false,
			limit: limit + 1,
			offset,
		})

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

		if (offset === 0 && !favoritesOnly && this.task?.taskId && !tasks.some((task) => task.id === this.task?.taskId)) {
			const taskMessage = this.task.messageStateHandler
				.getClineMessages()
				.find((message) => message.type === "say" && message.say === "task" && message.text)
			const matchesSearch = !searchQuery || taskMessage?.text?.toLowerCase().includes(searchQuery.toLowerCase())
			if (taskMessage?.text && matchesSearch) {
				tasks.unshift({
					id: this.task.taskId,
					task: formatDisplayUserInput(taskMessage.text),
					ts: taskMessage.ts || Date.now(),
					isFavorited: false,
					size: 0,
					totalCost: 0,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					modelId: this.task.api?.getModel?.().id ?? "",
				})
			}
		}

		return TaskHistoryArray.create({ tasks: tasks.slice(0, limit), hasMore })
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
				const tasksDeleted = await this.taskHistory.deleteAllTaskHistory({
					preserveFavorites: true,
				})
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
		return DeleteAllTaskHistoryCount.create({
			tasksDeleted: tasksDeleted || totalTasks,
		})
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
		// Import dynamically to avoid circular deps
		const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
		const state = await this.getStateToPostToWebview()
		await sendStateUpdate(state)
	}

	/**
	 * Reset the message translator's streaming state AND bump the conversation/replica fence
	 * (epoch). Called at every conversation boundary (task start/clear, history open, reinit,
	 * mode rebuild, new-session follow-up). Bumping the epoch BEFORE the new state is pushed
	 * means any straggler message/state from the previous task or render carries an older epoch
	 * and is dropped by the webview. Order matters: bump synchronously here, before any await.
	 */
	resetMessageTranslatorAndFence(): void {
		this.messageTranslatorState.reset()
		this.messageTranslatorState.getMinter().bumpEpoch()
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Build the base ExtensionState from StateManager, then layer the SDK's
		// task history on top.
		try {
			syncTelemetrySettingFromSharedGlobalSettings(this.stateManager)
			const { getStateToPostToWebview: buildBaseState } = await import("@core/controller/state/getStateToPostToWebview")
			const state = await buildBaseState({
				task: this.task,
				stateManager: this.stateManager,
				mcpHub: this.mcpHub,
				backgroundCommandRunning: this.backgroundCommandRunning,
				backgroundCommandTaskId: this.backgroundCommandTaskId,
			})
			const sdkTaskHistory = (await this.taskHistory.listHistory({ limit: 100, hydrate: false }))
				.map(sessionHistoryRecordToHistoryItem)
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
			const legacyTaskHistory = state.taskHistory ?? []
			const mergedTaskHistoryById = new Map<string, HistoryItem>()

			// Keep the SDK records authoritative for migrated/new tasks, but append
			// legacy persisted history so pre-migration tasks still appear in the UI.
			for (const item of legacyTaskHistory) {
				mergedTaskHistoryById.set(item.id, item)
			}
			for (const item of sdkTaskHistory) {
				mergedTaskHistoryById.set(item.id, item)
			}

			// A just-started task may not be visible in SDK persisted history yet (the
			// history adapter can lag behind the active in-memory TaskProxy). Classic
			// state included the current task immediately, and the testing platform
			// asserts that taskHistory reflects newTask before the model turn completes.
			if (this.task?.taskId && !mergedTaskHistoryById.has(this.task.taskId)) {
				const taskMessage = this.task.messageStateHandler
					.getClineMessages()
					.find((message) => message.type === "say" && message.say === "task" && message.text)
				if (taskMessage?.text) {
					mergedTaskHistoryById.set(this.task.taskId, {
						id: this.task.taskId,
						ts: taskMessage.ts || Date.now(),
						task: taskMessage.text,
						tokensIn: 0,
						tokensOut: 0,
						cacheWrites: 0,
						cacheReads: 0,
						totalCost: 0,
						modelId: this.task.api?.getModel?.().id,
						cwdOnTaskInitialization: await this.getWorkspaceRoot(),
					})
				}
			}

			const processedTaskHistory = Array.from(mergedTaskHistoryById.values())
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
				.slice(0, 100)

			// Stamp the snapshot with the current epoch and a fresh monotonic version, sampled
			// from the SAME counter that stamps messages. This lets the webview ignore stale
			// out-of-order state pushes and fence traffic from a previous task/render. Sampled
			// synchronously here (no await between sampling and return).
			const minter = this.messageTranslatorState.getMinter()
			return {
				...state,
				currentTaskItem: this.task?.taskId
					? processedTaskHistory.find((item) => item.id === this.task?.taskId)
					: undefined,
				taskHistory: processedTaskHistory,
				turnState: this.turnStateTracker.get(),
				stateVersion: minter.nextSeq(),
				epoch: minter.epoch,
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
