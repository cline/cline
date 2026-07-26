// Replaces classic src/core/controller/index.ts (see origin/main)
//
// The SDK-backed Controller. It provides the same interface as the classic
// Controller but delegates session lifecycle (initTask, askResponse,
// cancelTask, …) to the BedrockCoder SDK (@bedrock-coder/core) and bridges SDK events to
// the webview's gRPC streams.
import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
	compareCheckpointToWorkspace,
	createUserInstructionConfigService,
	resolveDefaultMcpSettingsPath,
	type SessionHistoryRecord,
	type UserInstructionConfigService,
} from "@bedrock-coder/core"
import type { CreateTeamTaskInput, TeamBoardSnapshot, TeamRunRecord, TeamTask, UpdateTeamTaskInput } from "@bedrock-coder/shared"
import { formatDisplayUserInput } from "@bedrock-coder/shared"
import type { ChatContent } from "@shared/ChatContent"
import { mentionRegexGlobal } from "@shared/context-mentions"
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import {
	DeleteAllTaskHistoryCount,
	type GetTaskHistoryRequest,
	TaskHistoryArray,
	TaskResponse,
} from "@shared/proto/bedrock_coder/task"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { BedrockCoderCheckpointRestore } from "@shared/WebviewMessage"
import { sendTeamBoardUpdate } from "@/core/controller/team/subscribeToTeamBoard"
import { parseMentions } from "@/core/mentions"
import { ensureMcpServersDirectoryExists } from "@/core/storage/disk"
import { StateManager } from "@/core/storage/StateManager"
import { WorkspaceRootManager } from "@/core/workspace/WorkspaceRootManager"
import { HostProvider } from "@/hosts/host-provider"
import { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { ExtensionRegistryInfo } from "@/registry"
import { BedrockStartupController } from "@/services/bedrock/bedrock-startup-controller"
import { UrlContentFetcher } from "@/services/browser/UrlContentFetcher"
import { McpHub } from "@/services/mcp/McpHub"
import type { BedrockCoderExtensionContext } from "@/shared/bedrock-coder"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { arePathsEqual, getDesktopDir } from "@/utils/path"
import { buildStartSessionInput, createHistoryItemFromSession } from "./bedrock-coder-session-factory"
import { MessageTranslatorState } from "./message-translator"
import { AgentRunLifecycle, sanitizeRunFailure } from "./run-lifecycle"
import {
	findVisibleCheckpointUserMessageByRun,
	getCheckpointRunCountForMessage,
	isVisibleCheckpointUserMessage,
} from "./sdk-checkpoints"
import { SdkCompactionCoordinator } from "./sdk-compaction-coordinator"
import { SdkDiffEditCoordinator } from "./sdk-diff-edit-coordinator"
import { SdkFollowupCoordinator } from "./sdk-followup-coordinator"
import { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMcpCoordinator } from "./sdk-mcp-coordinator"
import { SdkMessageCoordinator, type SessionEventListener } from "./sdk-message-coordinator"
import { SdkModeCoordinator } from "./sdk-mode-coordinator"
import { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import { SdkSessionEventCoordinator } from "./sdk-session-event-coordinator"
import { SdkSessionHistoryLoader } from "./sdk-session-history-loader"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import { SdkTaskControlCoordinator } from "./sdk-task-control-coordinator"
import { SdkTaskHistory, sessionHistoryRecordToHistoryItem } from "./sdk-task-history"
import { SdkTaskStartCoordinator } from "./sdk-task-start-coordinator"
import { SdkTerminalExecutionModeCoordinator } from "./sdk-terminal-execution-mode-coordinator"
import { SdkToolResultStore, type StoredToolResult } from "./sdk-tool-result-store"
import {
	extractSdkUserText,
	findSdkUserMessageIndexByOrdinal,
	isSyntheticSdkUserMessage,
	type SdkUserMessage,
} from "./sdk-user-message-mapping"
import type { SdkSessionHost } from "./session-host"
import { StatePostDebouncer } from "./state-post-debouncer"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import { TurnStateTracker } from "./turn-state-tracker"
import { VscodeSessionHost } from "./vscode-session-host"
import type { VscodeTerminalExecutionMode } from "./vscode-terminal-execution-mode"
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
		isLegacy: item.isLegacy ?? false,
	})
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class Controller {
	// SDK session state and the coordinators that drive it.
	private messageTranslatorState: MessageTranslatorState
	private turnStateTracker!: TurnStateTracker
	private readonly runLifecycle = new AgentRunLifecycle()
	private readonly toolResults = new SdkToolResultStore()
	private messages: SdkMessageCoordinator
	private sessions: SdkSessionLifecycle
	private sessionRebuilds: SdkSessionRebuildScheduler
	private interactions: SdkInteractionCoordinator
	private diffEdits: SdkDiffEditCoordinator
	private sessionConfigBuilder: SdkSessionConfigBuilder
	private taskHistory: SdkTaskHistory
	private mode: SdkModeCoordinator
	private mcpTools: SdkMcpCoordinator
	private terminalExecutionMode: SdkTerminalExecutionModeCoordinator
	private followups: SdkFollowupCoordinator
	private taskControl: SdkTaskControlCoordinator
	private taskStart: SdkTaskStartCoordinator
	private compaction: SdkCompactionCoordinator
	private sessionEvents: SdkSessionEventCoordinator
	private sessionHistory: SdkSessionHistoryLoader

	// Debounces/coalesces postStateToWebview() calls — see StatePostDebouncer.
	private static readonly STATE_POST_DEBOUNCE_MS = 50
	private readonly statePostDebouncer: StatePostDebouncer

	// Bridges SDK events to the webview's gRPC streams.
	private grpcBridge: WebviewGrpcBridge

	// Presents the Task interface that gRPC handlers expect, delegating to the
	// active SDK session.
	task?: TaskProxy

	mcpHub: McpHub
	readonly stateManager: StateManager
	readonly bedrockStartup: BedrockStartupController

	// Lazy terminal manager for foreground (VS Code terminal) command execution.
	// Created on first use; shared across all sessions in this Controller's lifetime.
	// Only used in the `vscodeTerminal` execution mode — `backgroundExec` and the
	// standalone (JetBrains/CLI) host run commands through the SDK's built-in tool.
	private _terminalManager?: VscodeTerminalManager

	// Registry of in-flight foreground (VS Code terminal) command executions.
	// Owned here — not by the session — so it survives session rebuilds, which
	// recreate the tool set. Drives the "Proceed While Running" button.
	private readonly foregroundCommands = new SdkForegroundCommandCoordinator({
		onRunningChanged: () => {
			void this.postStateToWebview()
		},
	})

	// Private state kept for stub compatibility
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string
	checkpointRestoreInput?: ExtensionState["checkpointRestoreInput"]

	// Watches local user-instruction files (workflows/skills/rules). Used to expand
	// `/workflow` and `/skill` slash commands into their instruction bodies before
	// the prompt reaches the model — the same mechanism the CLI uses in
	// `buildUserInputMessage`. The agent loop never auto-expands commands, so this
	// host-side expansion is required. Created lazily (memoized as a promise to be
	// race-free under concurrent first sends) and rebuilt if the workspace root
	// changes.
	private userInstructionService?: Promise<UserInstructionConfigService>
	private userInstructionServiceRoot?: string
	private isDisposed = false

	constructor(readonly context: BedrockCoderExtensionContext) {
		// StateManager must be initialized before creating the Controller
		this.stateManager = StateManager.get()
		this.statePostDebouncer = new StatePostDebouncer({
			debounceMs: Controller.STATE_POST_DEBOUNCE_MS,
			flush: () => this.flushStateToWebview(),
		})
		// IMPORTANT: Use ~/.bedrock-coder/data/settings/ for the settings directory,
		// NOT ensureSettingsDirectoryExists() which returns the VSCode extension
		// storage path (HostProvider.globalStorageFsPath/settings/). The MCP
		// settings file lives at ~/.bedrock-coder/data/settings/mcp_settings.json
		// (shared across VSCode, CLI, and JetBrains clients).
		this.mcpHub = new McpHub(
			() => ensureMcpServersDirectoryExists(),
			async () => {
				const settingsDir = path.dirname(resolveDefaultMcpSettingsPath())
				await fs.mkdir(settingsDir, { recursive: true })
				return settingsDir
			},
			ExtensionRegistryInfo.version,
		)

		// Initialize message translator state
		this.messageTranslatorState = new MessageTranslatorState()
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
		this.diffEdits = new SdkDiffEditCoordinator({
			getCwd: () => this.getWorkspaceRoot(),
		})
		this.interactions = new SdkInteractionCoordinator({
			messages: this.messages,
			getSessionId: () => this.sessions.getActiveSession()?.sessionId ?? "",
			postStateToWebview: () => this.postStateToWebview(),
			// Share the single id/seq/epoch authority so interaction-minted ids (tool-approval
			// asks, ask_question, user_feedback) never collide with translator-minted ids.
			getMinter: () => this.messageTranslatorState.getMinter(),
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			onRunWaitingForApproval: (toolName) => {
				const runId = this.runLifecycle.currentRunId
				if (runId) this.runLifecycle.waitingForApproval(runId, toolName)
			},
			onRunResumed: () => {
				const runId = this.runLifecycle.currentRunId
				if (runId) this.runLifecycle.streaming(runId)
			},
			// Open the diff editor preview before the approval buttons render.
			onToolApprovalAsk: (request) => this.diffEdits.openForApproval(request.toolCallId, request.toolName, request.input),
			recordApprovedToolMessage: (toolCallId, messageTs) =>
				this.messageTranslatorState.recordApprovedToolMessageTs(toolCallId, messageTs),
			recordDeniedToolApproval: (toolCallId, toolName, reason) => {
				this.messageTranslatorState.recordDeniedToolApproval(toolCallId, toolName, reason)
				// A denied edit's executor never runs, so close its diff preview here. Covers
				// manual Reject and clearPending (task cancel/abort) in one place.
				void this.diffEdits.discardPreview(toolCallId)
			},
		})
		this.sessions = new SdkSessionLifecycle({
			mcpHub: this.mcpHub,
			requestToolApproval: (request) => this.interactions.handleRequestToolApproval(request),
			askQuestion: (question, options, context) => this.interactions.handleAskQuestion(question, options, context),
			editorExecutor: (input, cwd, context) => this.diffEdits.executeEditorTool(input, cwd, context),
			applyPatchExecutor: (input, cwd, context) => this.diffEdits.executeApplyPatchTool(input, cwd, context),
			onSessionEvent: (event) => {
				this.sessionEvents.handleSessionEvent(event).catch((err) => {
					Logger.error("[SdkController] Failed to handle session event:", err)
				})
				if (event.type === "team_progress") {
					sendTeamBoardUpdate(this)
				}
			},
			onDidBecomeIdle: () => this.handleSessionBecameIdle(),
			foregroundCommands: this.foregroundCommands,
			getTerminalManager: () => {
				// Guarded by getEffectiveTerminalExecutionMode() at the read sites
				// (vscode-session-host.ts, sdk-terminal-execution-mode-coordinator.ts):
				// this factory itself is only invoked when a caller has already
				// resolved to "vscodeTerminal" mode on a real VS Code host, but
				// VscodeTerminalManager's constructor still assumes
				// vscode.window.onDidStartTerminalShellExecution exists, which the
				// standalone (JetBrains/CLI) stub does not provide.
				if (!this._terminalManager) {
					this._terminalManager = new VscodeTerminalManager()
					this.applyTerminalSettings(this._terminalManager)
					Logger.log("[SdkController] Created VscodeTerminalManager for foreground terminal execution")
				}
				return this._terminalManager
			},
			// this.mode is assigned later in this constructor; the closure only
			// runs at send time, long after construction completes.
			consumeModeSwitchNotice: (sessionId) => this.mode.consumeModeSwitchNotice(sessionId),
			onSendComplete: async () => {
				// Normal flows close their diff sessions inline; anything left here is orphaned.
				void this.diffEdits.discardAllPreviews("turn complete")
				const runId = this.runLifecycle.currentRunId
				if (runId) this.runLifecycle.complete(runId)

				this.postStateToWebview().catch((err) => {
					Logger.error("[SdkController] Failed to post state after turn:", err)
				})
			},
			onRequestSent: (sessionId) => {
				const runId = this.runLifecycle.currentRunId
				if (runId) {
					this.runLifecycle.bindSession(runId, sessionId)
					this.runLifecycle.requestSent(runId)
					void this.postStateToWebview()
				}
			},
			onSendError: async (error, sessionId) => {
				// A turn failed — surface the sanitized provider error and allow retry.
				void this.diffEdits.discardAllPreviews("turn error")
				this.turnStateTracker.set("error")
				const runId = this.runLifecycle.currentRunId
				if (runId) this.runLifecycle.fail(runId, sanitizeRunFailure(error, "stream"))
				const errorMessage = error instanceof Error ? error.message : String(error)
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
				this.postStateToWebview().catch(() => {})
			},
		})
		this.sessionRebuilds = new SdkSessionRebuildScheduler({ sessions: this.sessions })
		this.taskHistory = new SdkTaskHistory({
			mcpHub: this.mcpHub,
			sessions: this.sessions,
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
			resetMessageTranslator: () => this.resetMessageTranslatorAndFence(),
			postStateToWebview: () => this.postStateToWebview(),
			getTurnPhase: () => this.turnStateTracker.currentPhase,
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			rebuilds: this.sessionRebuilds,
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
			rebuilds: this.sessionRebuilds,
		})
		this.terminalExecutionMode = new SdkTerminalExecutionModeCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: async (sdkHost, sessionId) =>
				(await this.sessionHistory.loadInitialMessages(sdkHost, sessionId)) ?? [],
			buildStartSessionInput,
			postStateToWebview: () => this.postStateToWebview(),
			rebuilds: this.sessionRebuilds,
		})
		this.followups = new SdkFollowupCoordinator({
			stateManager: this.stateManager,
			interactions: this.interactions,
			sessions: this.sessions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			sessionConfigBuilder: this.sessionConfigBuilder,
			waitForPendingRebuilds: async () => {
				await this.mode.waitForPendingRebuild()
				await this.sessionRebuilds.waitUntilSettled()
			},
			getTask: () => this.task,
			createTempSessionHost: () => VscodeSessionHost.create({ mcpHub: this.mcpHub }),
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: (sessionHost, taskId) => this.sessionHistory.loadInitialMessages(sessionHost, taskId),
			buildStartSessionInput,
			resolveContextMentions: (text) => this.resolveContextMentions(text),
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
			postStateToWebview: () => this.postStateToWebview(),
			revalidateBedrockForResume: async (taskId) => {
				const sourceRecord = await this.taskHistory.getSessionRecord(taskId)
				const savedTarget = sourceRecord?.metadata?.bedrockTarget
				const targetRecord =
					savedTarget && typeof savedTarget === "object" && !Array.isArray(savedTarget)
						? (savedTarget as Record<string, unknown>)
						: undefined
				const invocationId =
					(typeof targetRecord?.invocationId === "string" && targetRecord.invocationId.trim()) ||
					sourceRecord?.model?.trim()
				if (invocationId) {
					this.stateManager.setGlobalStateBatch({
						planModeApiModelId: invocationId,
						actModeApiModelId: invocationId,
					})
				}
				await this.bedrockStartup.start(true)
				this.bedrockStartup.assertReady()
			},
			onSessionAssigned: (sessionId) => {
				const runId = this.runLifecycle.currentRunId
				if (runId) this.runLifecycle.bindSession(runId, sessionId)
			},
			onInitError: (error) => {
				const runId = this.runLifecycle.currentRunId
				if (runId) this.runLifecycle.fail(runId, sanitizeRunFailure(error, "persistence", { retrySafe: true }))
			},
		})
		this.compaction = new SdkCompactionCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.sessionEvents = new SdkSessionEventCoordinator({
			messageTranslatorState: this.messageTranslatorState,
			sessions: this.sessions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			getTask: () => this.task,
			postStateToWebview: () => this.postStateToWebview(),
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			runLifecycle: this.runLifecycle,
			toolResults: this.toolResults,
			onQueuedPromptSubmitted: (sessionId) => {
				const runId = this.runLifecycle.begin({
					sessionId,
					invocationId: this.bedrockStartup.state.selectedTarget?.invocationId,
				})
				this.runLifecycle.requestSent(runId)
				return runId
			},
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

		this.bedrockStartup = new BedrockStartupController({
			stateManager: this.stateManager,
			workspaceRoot: async () => this.getWorkspaceRoot(),
			logDirectory: path.join(this.context.globalStorageUri.fsPath, "logs"),
			onStateChanged: () => this.postStateToWebview(),
		})
		if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
			queueMicrotask(() => {
				void this.bedrockStartup.start().catch((error) => {
					Logger.error("[SdkController] Bedrock startup doctor failed:", error)
				})
			})
		}

		Logger.log("[SdkController] Initialized with the Bedrock SDK adapter and gRPC bridge")
	}

	handleTerminalExecutionModeChanged(previous: VscodeTerminalExecutionMode, next: VscodeTerminalExecutionMode): void {
		this.terminalExecutionMode.handleTerminalExecutionModeChanged(previous, next)
	}

	private handleSessionBecameIdle(): void {
		if (this.mode?.hasPendingModeChange()) {
			// The mode rebuild reads the latest provider and tool configuration, so
			// it supersedes any passive rebuild that was queued for the old mode.
			this.sessionRebuilds.cancel("provider")
			this.mode.applyPendingModeChange().catch((error) => {
				Logger.error("[SdkController] Failed to apply deferred mode change:", error)
			})
			return
		}
		this.sessionRebuilds?.sessionBecameIdle()
	}

	async invalidateUserInstructionService(): Promise<void> {
		const userInstructionServicePromise = this.userInstructionService
		this.userInstructionService = undefined
		this.userInstructionServiceRoot = undefined
		if (userInstructionServicePromise) {
			await userInstructionServicePromise.then((service) => service.stop()).catch(() => {})
		}
	}

	async dispose(): Promise<void> {
		this.isDisposed = true
		this.bedrockStartup.dispose()
		this.sessionEvents.dispose()
		this.toolResults.clear()
		// Tear down the debounced state-post machinery before downstream resources
		// are disposed below — see StatePostDebouncer.dispose().
		await this.statePostDebouncer.dispose()
		await this.invalidateUserInstructionService()
		this.messages.cancelPendingSave()
		// Clear MCP tool list change callback before disposing McpHub
		this.mcpHub?.clearToolListChangeCallback()
		await this.diffEdits.discardAllPreviews("controller dispose")
		await this.clearTask()
		await this.sessions.dispose("SdkController.dispose")
		await this.taskHistory.dispose()
		this.mcpHub?.dispose?.()
		this.messages.dispose()
		Logger.log("[SdkController] Disposed")
	}

	// ---- Slash command + context mention resolution ----

	/**
	 * Lazily create (or rebuild on workspace-root change) the user-instruction
	 * watcher. Pointed at the workspace root so it discovers both local config
	 * from supported workspace and user configuration directories.
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
				skills: {
					workspacePath: workspaceRoot,
					includePluginSkills: true,
					cwd: workspaceRoot,
				},
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

	// ---- Session event subscription ----

	/**
	 * Subscribe to session events translated to BedrockCoderMessages.
	 * Returns an unsubscribe function.
	 */
	onSessionEvent(listener: SessionEventListener): () => void {
		return this.messages.onSessionEvent(listener)
	}

	getActiveTeamBoard(): TeamBoardSnapshot | undefined {
		const active = this.sessions.getActiveSession()
		return active?.sdkHost.getTeamBoard?.(active.sessionId)
	}

	createActiveTeamTask(input: Omit<CreateTeamTaskInput, "createdBy">): TeamTask {
		const active = this.sessions.getActiveSession()
		if (!active?.sdkHost.createTeamTask) {
			throw new Error("No active local team session")
		}
		const task = active.sdkHost.createTeamTask(active.sessionId, input)
		sendTeamBoardUpdate(this)
		return task
	}

	updateActiveTeamTask(input: UpdateTeamTaskInput): TeamTask {
		const active = this.sessions.getActiveSession()
		if (!active?.sdkHost.updateTeamTask) {
			throw new Error("No active local team session")
		}
		const task = active.sdkHost.updateTeamTask(active.sessionId, input)
		sendTeamBoardUpdate(this)
		return task
	}

	cancelActiveTeamRun(runId: string, reason?: string): TeamRunRecord {
		const active = this.sessions.getActiveSession()
		if (!active?.sdkHost.cancelTeamRun) {
			throw new Error("No active local team session")
		}
		const run = active.sdkHost.cancelTeamRun(active.sessionId, runId, reason)
		sendTeamBoardUpdate(this)
		return run
	}

	private getTaskModelId(): string | undefined {
		const modelId = this.task?.api?.getModel?.().id?.trim()
		return modelId && modelId !== "unknown" ? modelId : undefined
	}

	async getLocalDiagnosticContext(): Promise<{
		taskId?: string
		teamTaskId?: string
		worktreePath?: string
		checkpointId?: string
	}> {
		const activeSession = this.sessions.getActiveSession()
		const taskId = activeSession?.sessionId ?? this.task?.taskId
		const record = activeSession && taskId ? await activeSession.sdkHost.get(taskId).catch(() => undefined) : undefined
		const latestCheckpoint =
			record?.metadata?.checkpoint &&
			typeof record.metadata.checkpoint === "object" &&
			!Array.isArray(record.metadata.checkpoint)
				? (record.metadata.checkpoint as Record<string, unknown>).latest
				: undefined
		const checkpoint =
			latestCheckpoint && typeof latestCheckpoint === "object" && !Array.isArray(latestCheckpoint)
				? (latestCheckpoint as Record<string, unknown>)
				: undefined
		const board = activeSession?.sdkHost.getTeamBoard?.(activeSession.sessionId)
		const linkedTask = board?.tasks.find((candidate) => candidate.sessionId === taskId)
		return {
			taskId,
			teamTaskId: linkedTask?.id,
			worktreePath: linkedTask?.worktreePath,
			checkpointId:
				(typeof checkpoint?.checkpointId === "string" && checkpoint.checkpointId) ||
				(typeof checkpoint?.ref === "string" && checkpoint.ref) ||
				undefined,
		}
	}

	private getSessionProviderId(sessionId?: string): string | undefined {
		const activeSession = this.sessions.getActiveSession()
		if (sessionId && activeSession?.sessionId !== sessionId) {
			return undefined
		}
		const providerId =
			activeSession?.startResult?.manifest?.provider?.trim() || activeSession?.startConfig?.providerId?.trim()
		return providerId && providerId !== "unknown" ? providerId : undefined
	}

	private getSessionModelId(sessionId?: string): string | undefined {
		const activeSession = this.sessions.getActiveSession()
		if (sessionId && activeSession?.sessionId !== sessionId) {
			return undefined
		}
		const modelId = activeSession?.startResult?.manifest?.model?.trim() || activeSession?.startConfig?.modelId?.trim()
		return modelId && modelId !== "unknown" ? modelId : undefined
	}

	// ---- Task lifecycle ----

	async initTask(
		prompt?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
	): Promise<string | undefined> {
		this.bedrockStartup.assertReady()
		const hasPrompt = Boolean(prompt?.trim() || images?.length || files?.length)
		if (hasPrompt) {
			this.runLifecycle.begin({
				invocationId: this.bedrockStartup.state.selectedTarget?.invocationId,
			})
			void this.postStateToWebview()
		} else {
			this.runLifecycle.reset()
		}
		// A new task is starting — the agent is about to stream.
		this.turnStateTracker.set("streaming")
		// Clear the previous turn's completion signal so this turn's phase is computed fresh.
		this.messageTranslatorState.clearTurnOutcome()
		return this.taskStart.initTask(prompt, images, files, historyItem, taskSettings)
	}

	async reinitExistingTaskFromId(taskId: string): Promise<void> {
		this.runLifecycle.reset()
		this.turnStateTracker.set("streaming")
		this.messageTranslatorState.clearTurnOutcome()
		await this.taskStart.reinitExistingTaskFromId(taskId)
	}

	async cancelTask(): Promise<void> {
		const runId = this.runLifecycle.currentRunId
		if (runId) {
			this.runLifecycle.requestCancellation(runId)
			void this.postStateToWebview()
		}
		// Fence first: mark resumable before aborting so any straggler events from the aborted
		// turn land on the wrong side of the UI mode. (Full fence-before-abort epoch bump lands
		// in S6; this sets the authoritative phase now.)
		this.turnStateTracker.set("resumable")
		await this.taskControl.cancelTask()
		if (runId) this.runLifecycle.cancelled(runId)
		await this.postStateToWebview()
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	/**
	 * "Proceed While Running": detach every in-flight foreground terminal
	 * command. Each pending run_commands call returns its partial output plus
	 * the log file path the remaining output is redirected to, and the agent
	 * turn continues while the commands keep running in their terminals.
	 */
	async proceedWhileRunningCommand(): Promise<void> {
		const detached = this.foregroundCommands.proceedWhileRunning()
		if (detached === 0) {
			Logger.warn("[SdkController] proceedWhileRunningCommand: No foreground command is running")
		}
	}

	async cancelQueuedPrompt(promptId: string): Promise<void> {
		const trimmedPromptId = promptId.trim()
		if (!trimmedPromptId) {
			Logger.warn("[SdkController] cancelQueuedPrompt: Missing prompt id")
			return
		}

		const activeSession = this.sessions.getActiveSession()
		if (!activeSession) {
			Logger.warn("[SdkController] cancelQueuedPrompt: No active session")
			return
		}

		const result = await activeSession.sdkHost.pendingPrompts("delete", {
			sessionId: activeSession.sessionId,
			promptId: trimmedPromptId,
		})
		if (!result.removed) {
			Logger.warn(`[SdkController] cancelQueuedPrompt: Prompt not found: ${trimmedPromptId}`)
		}
		await this.postStateToWebview()
	}

	/**
	 * Manually compact (condense) the active task's conversation. Triggered by
	 * the compact button and the `/compact` (alias `/smol`) slash command.
	 * Mirrors the CLI's `/compact` local command: runs an SDK manual compaction
	 * and persists the compaction sidecar so the model's working context is
	 * reduced on the next turn and later resumes.
	 */
	async compactTask(): Promise<void> {
		await this.compaction.compactTask()
	}

	async clearTask(): Promise<void> {
		// No active task — UI returns to idle (input enabled, no buttons/thinking).
		this.turnStateTracker.set("idle")
		this.runLifecycle.reset()
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
		this.bedrockStartup.assertReady()
		const turnStateBefore = this.turnStateTracker.get()
		const activeSession = this.sessions.getActiveSession()
		if (!activeSession?.isRunning) {
			this.runLifecycle.begin({
				sessionId: activeSession?.sessionId ?? this.task?.taskId,
				invocationId: this.bedrockStartup.state.selectedTarget?.invocationId,
			})
			void this.postStateToWebview()
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
		await this.followups.askResponse(prompt, images, files, this.task?.taskState?.askResponse, turnStateBefore.phase)
	}

	async editMessageAndRegenerate(input: {
		messageTs: number
		text: string
		images?: string[]
		files?: string[]
		restoreWorkspace?: boolean
	}): Promise<void> {
		this.bedrockStartup.assertReady()
		const editedText = input.text.trim()
		if (!editedText && (input.images?.length ?? 0) === 0 && (input.files?.length ?? 0) === 0) {
			throw new Error("Edited message cannot be empty")
		}

		const activeSession = this.sessions.getActiveSession()
		const currentTask = this.task
		if (!currentTask) {
			throw new Error("No active task to edit")
		}

		const bedrockCoderMessages = currentTask.messageStateHandler.getBedrockCoderMessages()
		const targetIndex = bedrockCoderMessages.findIndex((message) => message.ts === input.messageTs)
		if (targetIndex === -1) {
			throw new Error("Message to edit was not found")
		}
		const targetMessage = bedrockCoderMessages[targetIndex]
		if (targetMessage.type !== "say" || (targetMessage.say !== "task" && targetMessage.say !== "user_feedback")) {
			throw new Error("Only user messages can be edited")
		}

		const userOrdinal = bedrockCoderMessages
			.slice(0, targetIndex + 1)
			.filter((message) => message.type === "say" && (message.say === "task" || message.say === "user_feedback")).length
		const checkpointRunCount = getCheckpointRunCountForMessage(bedrockCoderMessages, targetIndex)
		const sourceSessionId = activeSession?.sessionId ?? currentTask.taskId
		let sdkMessages: SdkUserMessage[]
		let tempHost: VscodeSessionHost | undefined
		const sessionHost = activeSession?.sdkHost ?? (tempHost = await VscodeSessionHost.create({ mcpHub: this.mcpHub }))
		try {
			sdkMessages = (await sessionHost.readMessages(sourceSessionId)) as SdkUserMessage[]
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
				userOrdinal === 1
					? editedText
					: extractSdkUserText(firstUserMessage ?? {}) || bedrockCoderMessages[0]?.text || editedText
			const fallbackCwd = await this.getWorkspaceRoot()
			const [sessionRecord, historyItem] = await Promise.all([
				sessionHost.get(sourceSessionId).catch(() => undefined),
				this.taskHistory.findHistoryItem(currentTask.taskId).catch(() => undefined),
			])
			const cwd =
				sessionRecord?.cwd?.trim() ||
				sessionRecord?.workspaceRoot?.trim() ||
				historyItem?.cwdOnTaskInitialization?.trim() ||
				fallbackCwd
			const mode = this.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
			const config = await this.sessionConfigBuilder.build({ cwd, mode, prompt: historyTitle })

			const resolvedPrompt = await this.resolveContextMentions(editedText)
			const startInput = {
				...buildStartSessionInput(config, { prompt: historyTitle, cwd, mode }),
				initialMessages,
				sessionMetadata: {
					title: historyTitle,
					modelId: config.modelId,
				},
			}

			if (input.restoreWorkspace) {
				if (activeSession?.isRunning) {
					throw new Error("Wait for the current run to finish before restoring workspace changes")
				}
				if (checkpointRunCount === undefined) {
					throw new Error("Workspace restore is only available for messages that started an agent run")
				}
				const approved = await this.approveCheckpointWorkspaceRestore(
					sessionHost,
					sourceSessionId,
					checkpointRunCount,
					cwd,
				)
				if (!approved) {
					return
				}
				await sessionHost.restore({
					sessionId: sourceSessionId,
					checkpointRunCount,
					cwd,
					restore: {
						messages: false,
						workspace: true,
						workspaceApproved: true,
						omitCheckpointMessageFromSession: true,
					},
				})
			}

			const { startResult, sdkHost } = await this.sessions.startNewSession(startInput)

			this.turnStateTracker.set("streaming")
			this.messageTranslatorState.clearTurnOutcome()
			this.resetMessageTranslatorAndFence()

			const task = createTaskProxy(
				startResult.sessionId,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)
			this.task = task

			const newHistoryItem = createHistoryItemFromSession(startResult.sessionId, historyTitle, config.modelId, cwd)
			await this.taskHistory.updateTaskHistoryItem(newHistoryItem)

			const visibleMessages = bedrockCoderMessages.slice(0, targetIndex)
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

			this.sessions.fireAndForgetSend(sdkHost, startResult.sessionId, resolvedPrompt, input.images, input.files)
		} finally {
			await tempHost?.dispose("editMessageAndRegenerate")
		}
	}

	async restoreCheckpoint(input: { checkpointRunCount: number; restoreType: BedrockCoderCheckpointRestore }): Promise<void> {
		const restoreMessages = input.restoreType === "task" || input.restoreType === "taskAndWorkspace"
		const restoreWorkspace = input.restoreType === "workspace" || input.restoreType === "taskAndWorkspace"
		const checkpointRunCount = Number(input.checkpointRunCount)
		if (!Number.isInteger(checkpointRunCount) || checkpointRunCount < 1) {
			throw new Error("checkpointRunCount must be a positive integer")
		}

		const activeSession = this.sessions.getActiveSession()
		const currentTask = this.task
		if (!activeSession || !currentTask) {
			throw new Error("No active task to restore")
		}
		const currentMessages = currentTask.messageStateHandler.getBedrockCoderMessages()
		const target = restoreMessages ? findVisibleCheckpointUserMessageByRun(currentMessages, checkpointRunCount) : undefined
		if (restoreMessages && !target) {
			throw new Error(`Could not find user message for checkpoint run ${checkpointRunCount}`)
		}

		const cwd = await this.getWorkspaceRoot()
		if (restoreWorkspace) {
			const approved = await this.approveCheckpointWorkspaceRestore(
				activeSession.sdkHost,
				activeSession.sessionId,
				checkpointRunCount,
				cwd,
			)
			if (!approved) {
				return
			}
		}
		if (activeSession.isRunning) {
			await this.cancelTask()
		}
		const mode = this.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		const firstUserMessage = currentMessages.find(isVisibleCheckpointUserMessage)
		const restoredText = target?.message.text ?? ""
		const historyTitle = checkpointRunCount === 1 ? restoredText : firstUserMessage?.text || restoredText
		const config = restoreMessages ? await this.sessionConfigBuilder.build({ cwd, mode, prompt: historyTitle }) : undefined

		const startInput = config
			? {
					...buildStartSessionInput(config, { prompt: historyTitle, cwd, mode }),
					sessionMetadata: {
						title: historyTitle,
						modelId: config.modelId,
					},
				}
			: undefined

		const restored = await this.sessions.restoreActiveSession({
			sessionId: activeSession.sessionId,
			checkpointRunCount,
			cwd,
			restore: {
				messages: restoreMessages,
				workspace: restoreWorkspace,
				workspaceApproved: restoreWorkspace,
				omitCheckpointMessageFromSession: true,
			},
			...(startInput ? { start: startInput } : {}),
		})

		if (!restoreMessages) {
			await this.postStateToWebview()
			return
		}

		if (!restored.sessionId || !restored.startResult || !target) {
			throw new Error("Checkpoint restore did not return a new session")
		}

		this.turnStateTracker.set("idle")
		this.messageTranslatorState.clearTurnOutcome()
		this.resetMessageTranslatorAndFence()

		const task = createTaskProxy(
			restored.sessionId,
			(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
			() => this.cancelTask(),
		)
		this.task = task

		const newHistoryItem = createHistoryItemFromSession(restored.sessionId, historyTitle, config?.modelId ?? "", cwd)
		await this.taskHistory.updateTaskHistoryItem(newHistoryItem)

		const visibleMessages = currentMessages.slice(0, target.index)
		if (visibleMessages.length > 0) {
			this.messages.replaceMessages(visibleMessages)
		}

		this.checkpointRestoreInput = {
			text: restoredText,
			images: target.message.images ?? [],
			files: target.message.files ?? [],
			sessionId: restored.sessionId,
		}
		await this.postStateToWebview()
	}

	private async approveCheckpointWorkspaceRestore(
		sessionHost: SdkSessionHost,
		sessionId: string,
		checkpointRunCount: number,
		cwd: string,
	): Promise<boolean> {
		const session = await sessionHost.get(sessionId)
		if (!session) {
			throw new Error(`Session ${sessionId} was not found`)
		}
		const comparison = await compareCheckpointToWorkspace({
			session,
			checkpointRunCount,
			cwd,
		})
		const unrestorable = comparison.diffs.filter((diff) => !diff.restorable)
		if (unrestorable.length > 0) {
			throw new Error(
				`Checkpoint cannot be restored safely: ${unrestorable.map((diff) => path.basename(diff.filePath)).join(", ")}`,
			)
		}
		const summary = comparison.diffs
			.slice(0, 20)
			.map((diff) => `${diff.status}: ${path.relative(cwd, diff.filePath)}`)
			.join("\n")
		const omitted = Math.max(0, comparison.diffs.length - 20)
		const response = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Restore ${comparison.diffs.length} workspace file${comparison.diffs.length === 1 ? "" : "s"} from checkpoint?`,
			options: {
				modal: true,
				items: ["Restore Workspace"],
				detail: `${summary || "The workspace already matches this checkpoint."}${omitted ? `\n…and ${omitted} more` : ""}\n\nThe checkpoint will be preserved. No git reset, clean, commit, or push will run.`,
			},
		})
		return response.selectedOption === "Restore Workspace"
	}

	/**
	 * Show a task from history by loading its messages.
	 * This does NOT start inference — it just loads the task for viewing.
	 *
	 * IMPORTANT: We do NOT call clearTask() here because clearTask() sets
	 * this.task = undefined and may trigger async operations (session stop/dispose)
	 * that race with the new task proxy creation. If any of those async operations
	 * trigger postStateToWebview() while this.task is undefined, the webview
	 * receives a state with no currentTaskItem/bedrockCoderMessages and flashes back
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

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		return this.mode.togglePlanActMode(modeToSwitchTo, chatContent)
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
				isLegacy: false,
			}
		})

		if (offset === 0 && !favoritesOnly && this.task?.taskId && !tasks.some((task) => task.id === this.task?.taskId)) {
			const taskMessage = this.task.messageStateHandler
				.getBedrockCoderMessages()
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
					isLegacy: false,
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

		const taskDirPath = historyItem.messagesPath ? path.dirname(historyItem.messagesPath) : undefined
		if (!taskDirPath) {
			throw new Error(`Task history item has no artifact path: ${id}`)
		}

		await fs.access(taskDirPath)
		Logger.log(`[EXPORT] Opening task directory: ${taskDirPath}`)
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

	/**
	 * Request a webview state update.
	 *
	 * Callers fire this very frequently (notably the session event coordinator,
	 * once per streamed message/turn boundary), and each rebuild walks the full
	 * task history. StatePostDebouncer coalesces bursts into a single trailing
	 * rebuild to avoid hammering the extension host. The returned promise
	 * resolves once a snapshot reflecting this request has been shipped, or
	 * rejects if that rebuild failed.
	 */
	postStateToWebview(): Promise<void> {
		if (this.isDisposed) {
			return Promise.resolve()
		}
		return this.statePostDebouncer.post()
	}

	/** Build the current ExtensionState and push it to the webview immediately. */
	private async flushStateToWebview(): Promise<void> {
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
			const { getStateToPostToWebview: buildBaseState } = await import("@core/controller/state/getStateToPostToWebview")
			const state = await buildBaseState({
				task: this.task,
				stateManager: this.stateManager,
				mcpHub: this.mcpHub,
				backgroundCommandRunning: this.backgroundCommandRunning,
				backgroundCommandTaskId: this.backgroundCommandTaskId,
				foregroundCommandRunning: this.foregroundCommands.isRunning,
			})
			const sdkTaskHistory = (await this.taskHistory.listHistory({ limit: 100, hydrate: false }))
				.map(sessionHistoryRecordToHistoryItem)
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
			const taskHistoryById = new Map<string, HistoryItem>()
			for (const item of sdkTaskHistory) {
				taskHistoryById.set(item.id, item)
			}

			// A just-started task may not be visible in SDK persisted history yet (the
			// history adapter can lag behind the active in-memory TaskProxy). Classic
			// state included the current task immediately, and the testing platform
			// asserts that taskHistory reflects newTask before the model turn completes.
			if (this.task?.taskId && !taskHistoryById.has(this.task.taskId)) {
				const taskMessage = this.task.messageStateHandler
					.getBedrockCoderMessages()
					.find((message) => message.type === "say" && message.say === "task" && message.text)
				if (taskMessage?.text) {
					taskHistoryById.set(this.task.taskId, {
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

			const processedTaskHistory = Array.from(taskHistoryById.values())
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
				.slice(0, 100)

			let queuedPrompts: ExtensionState["queuedPrompts"] = []
			const activeSession = this.sessions.getActiveSession()
			if (activeSession) {
				try {
					queuedPrompts = await activeSession.sdkHost.pendingPrompts("list", { sessionId: activeSession.sessionId })
				} catch (error) {
					Logger.error("[SdkController] Failed to list pending prompts for webview state:", error)
				}
			}

			// Stamp the snapshot with the current epoch and a fresh monotonic version, sampled
			// from the SAME counter that stamps messages. This lets the webview ignore stale
			// out-of-order state pushes and fence traffic from a previous task/render. Sampled
			// synchronously here (no await between sampling and return).
			const minter = this.messageTranslatorState.getMinter()
			return {
				...state,
				bedrockStartup: this.bedrockStartup.state,
				currentTaskItem: this.task?.taskId
					? processedTaskHistory.find((item) => item.id === this.task?.taskId)
					: undefined,
				taskHistory: processedTaskHistory,
				turnState: this.turnStateTracker.get(),
				runState: this.runLifecycle.get(),
				queuedPrompts,
				stateVersion: minter.nextSeq(),
				epoch: minter.epoch,
			}
		} catch (error) {
			Logger.error("[SdkController] Failed to get state for webview:", error)
			throw error
		}
	}

	getToolResult(id: string): StoredToolResult | undefined {
		return this.toolResults.get(id)
	}

	// ---- Terminal settings ----

	/**
	 * Apply the user's terminal settings from StateManager to a terminal manager.
	 * Called once when the lazy terminal manager is first created, and can be
	 * called again when settings change at runtime.
	 */
	applyTerminalSettings(terminalManager: VscodeTerminalManager): void {
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		if (shellIntegrationTimeout !== undefined) {
			terminalManager.setShellIntegrationTimeout(Number(shellIntegrationTimeout))
		}

		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		if (terminalReuseEnabled !== undefined) {
			terminalManager.setTerminalReuseEnabled(!!terminalReuseEnabled)
		}

		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		if (defaultTerminalProfile !== undefined && defaultTerminalProfile !== "") {
			terminalManager.setDefaultTerminalProfile(String(defaultTerminalProfile))
		}

		Logger.log(
			`[SdkController] Applied terminal settings: profile=${defaultTerminalProfile ?? "default"}, ` +
				`timeout=${shellIntegrationTimeout ?? 4000}, reuse=${terminalReuseEnabled ?? true}`,
		)
	}

	/**
	 * Get the terminal manager instance (if created).
	 * Used by updateSettings handlers to apply runtime changes.
	 */
	get terminalManager(): VscodeTerminalManager | undefined {
		return this._terminalManager
	}

	// ---- Workspace (kept from classic) ----

	private _workspaceManager?: WorkspaceRootManager
	private _workspaceManagerPathsKey?: string

	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		try {
			const { paths } = await HostProvider.workspace.getWorkspacePaths({})
			const validPaths = (paths ?? []).filter((workspacePath) => workspacePath.trim().length > 0)
			if (validPaths.length === 0) {
				return undefined
			}
			// Rebuild only when the set of workspace folders changes
			const pathsKey = JSON.stringify(validPaths)
			if (!this._workspaceManager || this._workspaceManagerPathsKey !== pathsKey) {
				this._workspaceManager = await WorkspaceRootManager.fromPaths(validPaths)
				this._workspaceManagerPathsKey = pathsKey
			}
			return this._workspaceManager
		} catch (error) {
			Logger.warn("[SdkController] Failed to build workspace manager:", error)
			return undefined
		}
	}
}
