import { ApiHandler, ApiProviderInfo } from "@core/api"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { EnvironmentContextTracker } from "@core/context/context-tracking/EnvironmentContextTracker"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists, getSavedApiConversationHistory, getSavedClineMessages } from "@core/storage/disk"
import { releaseTaskLock } from "@core/task/TaskLockUtils"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { buildCheckpointManager, shouldUseMultiRoot } from "@integrations/checkpoints/factory"
import { ICheckpointManager } from "@integrations/checkpoints/types"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { ITerminalManager } from "@integrations/terminal/types"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { ApiConfiguration } from "@shared/api"
import { findLastIndex } from "@shared/array"
import { ClineApiReqInfo, ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { convertClineMessageToProto } from "@shared/proto-conversions/cline-message"
import { ClineAskResponse } from "@shared/WebviewMessage"
import { isParallelToolCallingEnabled } from "@utils/model-utils"
import fs from "fs/promises"
import Mutex from "p-mutex"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { ulid } from "ulid"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import {
	type CommandExecutionOptions,
	CommandExecutor,
	CommandExecutorCallbacks,
	FullCommandExecutorConfig,
	StandaloneTerminalManager,
} from "@/integrations/terminal"
import { telemetryService } from "@/services/telemetry"
import {
	ClineContent,
	ClineImageContentBlock,
	ClineMessageModelInfo,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineToolResponseContent,
	ClineUserContent,
} from "@/shared/messages"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import type { Mode } from "@/shared/storage/types"
import { CoreAgent } from "../agents/CoreAgent"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import { MessageStateHandler } from "./message-state"
import { TaskAgentRuntime } from "./TaskAgentRuntime"
import { TaskHookExtensionAdapter } from "./TaskHookExtensionAdapter"
import { TaskState } from "./TaskState"
import { extractProviderDomainFromUrl } from "./utils"
import { buildUserFeedbackContent } from "./utils/buildUserFeedbackContent"

export type ToolResponse = ClineToolResponseContent

type TaskParams = {
	controller: Controller
	mcpHub: McpHub
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	postStateToWebview: () => Promise<void>
	reinitExistingTaskFromId: (taskId: string) => Promise<void>
	cancelTask: () => Promise<void>
	shellIntegrationTimeout: number
	terminalReuseEnabled: boolean
	terminalOutputLineLimit: number
	defaultTerminalProfile: string
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	cwd: string
	stateManager: StateManager
	workspaceManager?: WorkspaceRootManager
	task?: string
	images?: string[]
	files?: string[]
	historyItem?: HistoryItem
	taskId: string
	taskLockAcquired: boolean
}

export class Task {
	// Core task variables
	readonly taskId: string
	readonly ulid: string
	private taskIsFavorited?: boolean
	private cwd: string

	taskState: TaskState

	// ONE mutex for ALL state modifications to prevent race conditions
	private stateMutex = new Mutex()

	/**
	 * Execute function with exclusive lock on all task state
	 * Use this for ANY state modification to prevent races
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	/**
	 * Atomically set active hook execution with mutex protection
	 * Prevents TOCTOU races when setting hook execution state
	 */
	public async setActiveHookExecution(hookExecution: NonNullable<typeof this.taskState.activeHookExecution>): Promise<void> {
		await this.taskHookAdapter.setActiveHookExecution(hookExecution)
	}

	/**
	 * Atomically clear active hook execution with mutex protection
	 * Prevents TOCTOU races when clearing hook execution state
	 */
	public async clearActiveHookExecution(): Promise<void> {
		await this.taskHookAdapter.clearActiveHookExecution()
	}

	/**
	 * Atomically read active hook execution state with mutex protection
	 * Returns a snapshot of the current state to prevent TOCTOU races
	 */
	public async getActiveHookExecution(): Promise<typeof this.taskState.activeHookExecution> {
		return await this.taskHookAdapter.getActiveHookExecution()
	}

	// Core dependencies
	private controller: Controller
	private mcpHub: McpHub

	// Service handlers
	terminalManager: ITerminalManager
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	contextManager: ContextManager
	private diffViewProvider: DiffViewProvider
	public checkpointManager?: ICheckpointManager
	private clineIgnoreController: ClineIgnoreController
	private coreAgent: CoreAgent
	private taskAgentRuntime!: TaskAgentRuntime
	private taskHookAdapter!: TaskHookExtensionAdapter

	private get api(): ApiHandler {
		return this.coreAgent.getApiHandler()
	}

	public updateApiHandler(apiConfiguration: ApiConfiguration, mode: Mode): void {
		this.coreAgent.initializeApiHandler({ ...apiConfiguration, ulid: this.ulid }, mode)
	}

	public getModel(): ReturnType<ApiHandler["getModel"]> {
		return this.coreAgent.getModel()
	}

	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"

	// Metadata tracking
	private fileContextTracker: FileContextTracker
	private environmentContextTracker: EnvironmentContextTracker

	// Callbacks
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private postStateToWebview: () => Promise<void>
	private cancelTask: () => Promise<void>

	// Cache service
	private stateManager: StateManager

	// Message and conversation state
	messageStateHandler: MessageStateHandler

	// Workspace manager
	workspaceManager?: WorkspaceRootManager

	// Task Locking (Sqlite)
	private taskLockAcquired: boolean

	// Command executor for running shell commands (extracted from executeCommandTool)
	private commandExecutor!: CommandExecutor

	constructor(params: TaskParams) {
		const {
			controller,
			mcpHub,
			updateTaskHistory,
			postStateToWebview,
			cancelTask,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			terminalOutputLineLimit,
			defaultTerminalProfile,
			vscodeTerminalExecutionMode,
			cwd,
			stateManager,
			workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			taskLockAcquired,
		} = params

		this.taskState = new TaskState()
		this.controller = controller
		this.mcpHub = mcpHub
		this.updateTaskHistory = updateTaskHistory
		this.postStateToWebview = postStateToWebview
		this.cancelTask = cancelTask
		this.clineIgnoreController = new ClineIgnoreController(cwd)
		this.taskLockAcquired = taskLockAcquired
		// Determine terminal execution mode and create appropriate terminal manager
		this.terminalExecutionMode = vscodeTerminalExecutionMode || "vscodeTerminal"

		// When backgroundExec mode is selected, use StandaloneTerminalManager for hidden execution
		// Otherwise, use the HostProvider's terminal manager (VSCode terminal in VSCode, standalone in CLI)
		if (this.terminalExecutionMode === "backgroundExec") {
			// Import StandaloneTerminalManager for background execution
			this.terminalManager = new StandaloneTerminalManager()
			Logger.info(`[Task ${taskId}] Using StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Use the host-provided terminal manager (VSCode terminal in VSCode environment)
			this.terminalManager = HostProvider.get().createTerminalManager()
			Logger.info(`[Task ${taskId}] Using HostProvider terminal manager for vscodeTerminal mode`)
		}
		this.terminalManager.setShellIntegrationTimeout(shellIntegrationTimeout)
		this.terminalManager.setTerminalReuseEnabled(terminalReuseEnabled ?? true)
		this.terminalManager.setTerminalOutputLineLimit(terminalOutputLineLimit)
		this.terminalManager.setDefaultTerminalProfile(defaultTerminalProfile)

		this.urlContentFetcher = new UrlContentFetcher()
		this.browserSession = new BrowserSession(stateManager)
		this.contextManager = new ContextManager()
		this.cwd = cwd
		this.stateManager = stateManager
		this.workspaceManager = workspaceManager

		// DiffViewProvider opens Diff Editor during edits while FileEditProvider performs
		// edits in the background without stealing user's editor's focus.
		const backgroundEditEnabled = this.stateManager.getGlobalSettingsKey("backgroundEditEnabled")
		this.diffViewProvider = backgroundEditEnabled ? new FileEditProvider() : HostProvider.get().createDiffViewProvider()

		// Set up MCP notification callback for real-time notifications
		this.mcpHub.setNotificationCallback(async (serverName: string, _level: string, message: string) => {
			// Display notification in chat immediately
			await this.say("mcp_notification", `[${serverName}] ${message}`)
		})

		this.taskId = taskId

		// Initialize taskId first
		if (historyItem) {
			this.ulid = historyItem.ulid ?? ulid()
			this.taskIsFavorited = historyItem.isFavorited
			this.taskState.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
			if (historyItem.checkpointManagerErrorMessage) {
				this.taskState.checkpointManagerErrorMessage = historyItem.checkpointManagerErrorMessage
			}
		} else if (task || images || files) {
			this.ulid = ulid()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.messageStateHandler = new MessageStateHandler({
			taskId: this.taskId,
			ulid: this.ulid,
			taskState: this.taskState,
			taskIsFavorited: this.taskIsFavorited,
			updateTaskHistory: this.updateTaskHistory,
		})

		// Initialize context trackers
		this.fileContextTracker = new FileContextTracker(controller, this.taskId)
		this.environmentContextTracker = new EnvironmentContextTracker(this.taskId)

		// Check for multiroot workspace and warn about checkpoints
		const isMultiRootWorkspace = this.workspaceManager && this.workspaceManager.getRoots().length > 1
		const checkpointsEnabled = this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")

		if (isMultiRootWorkspace && checkpointsEnabled) {
			// Set checkpoint manager error message to display warning in TaskHeader
			this.taskState.checkpointManagerErrorMessage = "Checkpoints are not currently supported in multi-root workspaces."
		}

		// Initialize checkpoint manager based on workspace configuration
		if (!isMultiRootWorkspace) {
			try {
				this.checkpointManager = buildCheckpointManager({
					taskId: this.taskId,
					messageStateHandler: this.messageStateHandler,
					fileContextTracker: this.fileContextTracker,
					diffViewProvider: this.diffViewProvider,
					taskState: this.taskState,
					workspaceManager: this.workspaceManager,
					updateTaskHistory: this.updateTaskHistory,
					say: this.say.bind(this),
					cancelTask: this.cancelTask,
					postStateToWebview: this.postStateToWebview,
					initialConversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
					initialCheckpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
					stateManager: this.stateManager,
				})

				// If multi-root, kick off non-blocking initialization
				// Unreachable for now, leaving in for future multi-root checkpoint support
				if (
					shouldUseMultiRoot({
						workspaceManager: this.workspaceManager,
						enableCheckpoints: this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting"),
						stateManager: this.stateManager,
					})
				) {
					this.checkpointManager.initialize?.().catch((error: Error) => {
						Logger.error("Failed to initialize multi-root checkpoint manager:", error)
						this.taskState.checkpointManagerErrorMessage = error?.message || String(error)
					})
				}
			} catch (error) {
				Logger.error("Failed to initialize checkpoint manager:", error)
				if (this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `Failed to initialize checkpoint manager: ${errorMessage}`,
					})
				}
			}
		}

		// Prepare effective API configuration
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const effectiveApiConfiguration: ApiConfiguration = {
			...apiConfiguration,
			ulid: this.ulid,
			onRetryAttempt: async (attempt: number, maxRetries: number, delay: number, error: any) => {
				const clineMessages = this.messageStateHandler.getClineMessages()
				const lastApiReqStartedIndex = findLastIndex(clineMessages, (m) => m.say === "api_req_started")
				if (lastApiReqStartedIndex !== -1) {
					try {
						const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[lastApiReqStartedIndex].text || "{}")
						currentApiReqInfo.retryStatus = {
							attempt: attempt, // attempt is already 1-indexed from retry.ts
							maxAttempts: maxRetries, // total attempts
							delaySec: Math.round(delay / 1000),
							errorSnippet: error?.message ? `${String(error.message).substring(0, 50)}...` : undefined,
						}
						// Clear previous cancelReason and streamingFailedMessage if we are retrying
						delete currentApiReqInfo.cancelReason
						delete currentApiReqInfo.streamingFailedMessage
						await this.messageStateHandler.updateClineMessage(lastApiReqStartedIndex, {
							text: JSON.stringify(currentApiReqInfo),
						})

						// Post the updated state to the webview so the UI reflects the retry attempt
						await this.postStateToWebview().catch((e) =>
							Logger.error("Error posting state to webview in onRetryAttempt:", e),
						)
					} catch (e) {
						Logger.error(`[Task ${this.taskId}] Error updating api_req_started with retryStatus:`, e)
					}
				}
			},
		}
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const currentProvider = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider

		// Now that ulid is initialized, create the core agent runtime with API handler ownership
		this.coreAgent = new CoreAgent({
			apiConfiguration: effectiveApiConfiguration,
			mode,
		})
		this.taskHookAdapter = new TaskHookExtensionAdapter({
			taskId: this.taskId,
			ulid: this.ulid,
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			say: this.say.bind(this),
			postStateToWebview: this.postStateToWebview.bind(this),
			cancelTask: this.cancelTask.bind(this),
			withStateLock: this.withStateLock.bind(this),
		})

		// Set ulid on browserSession for telemetry tracking
		this.browserSession.setUlid(this.ulid)

		// initialize telemetry

		// Extract domain of the provider endpoint if using OpenAI Compatible provider
		let openAiCompatibleDomain: string | undefined
		if (currentProvider === "openai" && apiConfiguration.openAiBaseUrl) {
			openAiCompatibleDomain = extractProviderDomainFromUrl(apiConfiguration.openAiBaseUrl)
		}

		if (historyItem) {
			// Open task from history
			telemetryService.captureTaskRestarted(this.ulid, currentProvider, openAiCompatibleDomain)
		} else {
			// New task started
			telemetryService.captureTaskCreated(this.ulid, currentProvider, openAiCompatibleDomain)
		}

		// Initialize command executor with config and callbacks
		const commandExecutorConfig: FullCommandExecutorConfig = {
			cwd: this.cwd,
			terminalExecutionMode: this.terminalExecutionMode,
			terminalManager: this.terminalManager,
			taskId: this.taskId,
			ulid: this.ulid,
		}

		const commandExecutorCallbacks: CommandExecutorCallbacks = {
			say: this.say.bind(this) as CommandExecutorCallbacks["say"],
			ask: async (type: string, text?: string, partial?: boolean) => {
				const result = await this.ask(type as ClineAsk, text, partial)
				return {
					response: result.response,
					text: result.text,
					images: result.images,
					files: result.files,
				}
			},
			updateBackgroundCommandState: (isRunning: boolean) =>
				this.controller.updateBackgroundCommandState(isRunning, this.taskId),
			updateClineMessage: async (index: number, updates: { commandCompleted?: boolean; text?: string }) => {
				await this.messageStateHandler.updateClineMessage(index, updates)
			},
			getClineMessages: () => this.messageStateHandler.getClineMessages() as Array<{ ask?: string; say?: string }>,
			addToUserMessageContent: (content: { type: string; text: string }) => {
				// Cast to ClineTextContentBlock which is compatible with ClineContent
				this.taskState.userMessageContent.push({ type: "text", text: content.text } as ClineTextContentBlock)
			},
		}

		this.commandExecutor = new CommandExecutor(commandExecutorConfig, commandExecutorCallbacks)

		this.taskAgentRuntime = new TaskAgentRuntime({
			taskId: this.taskId,
			ulid: this.ulid,
			cwd: this.cwd,
			taskState: this.taskState,
			say: this.say.bind(this),
			postStateToWebview: this.postStateToWebview.bind(this),
			getCurrentProviderInfo: this.getCurrentProviderInfo.bind(this),
			getApiConfiguration: () => this.stateManager.getApiConfiguration(),
			loadContext: this.loadContext.bind(this),
			messageStateHandler: this.messageStateHandler,
			setActiveHookExecution: this.setActiveHookExecution.bind(this),
			clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
			runTaskLifecycleHook: this.taskHookAdapter.runTaskLifecycleHook.bind(this.taskHookAdapter),
			runUserPromptSubmitHook: this.taskHookAdapter.runUserPromptSubmitHook.bind(this.taskHookAdapter),
			handleHookCancellation: this.taskHookAdapter.handleHookCancellation.bind(this.taskHookAdapter),
			createAgentHooks: this.taskHookAdapter.createAgentHooks.bind(this.taskHookAdapter),
			cancelTask: this.cancelTask.bind(this),
		})
	}

	// Communicate with webview

	// partial has three valid states true (partial message), false (completion of partial message), undefined (individual complete message)
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
	): Promise<{
		response: ClineAskResponse
		text?: string
		images?: string[]
		files?: string[]
		askTs?: number
	}> {
		// Allow resume asks even when aborted to enable resume button after cancellation
		if (this.taskState.abort && type !== "resume_task" && type !== "resume_completed_task") {
			throw new Error("Cline instance aborted")
		}
		let askTs: number
		if (partial !== undefined) {
			const clineMessages = this.messageStateHandler.getClineMessages()
			const lastMessage = clineMessages.at(-1)
			const lastMessageIndex = clineMessages.length - 1

			const isUpdatingPreviousPartial = lastMessage?.partial && lastMessage?.type === "ask" && lastMessage?.ask === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					await this.messageStateHandler.updateClineMessage(lastMessageIndex, {
						text,
						partial,
					})
					// todo be more efficient about saving and posting only new data or one whole message at a time so ignore partial for saves, and only post parts of partial message instead of whole array in new listener
					// await this.saveClineMessagesAndUpdateHistory()
					// await this.postStateToWebview()
					const protoMessage = convertClineMessageToProto(lastMessage)
					await sendPartialMessageEvent(protoMessage)
					throw new Error("Current ask promise was ignored 1")
				}
				// this is a new partial message, so add it with partial state
				// this.askResponse = undefined
				// this.askResponseText = undefined
				// this.askResponseImages = undefined
				askTs = Date.now()
				this.taskState.lastMessageTs = askTs
				await this.messageStateHandler.addToClineMessages({
					ts: askTs,
					type: "ask",
					ask: type,
					text,
					partial,
				})
				await this.postStateToWebview()
				throw new Error("Current ask promise was ignored 2")
			}
			// partial=false means its a complete version of a previously partial message
			if (isUpdatingPreviousPartial) {
				// this is the complete version of a previously partial message, so replace the partial with the complete version
				this.taskState.askResponse = undefined
				this.taskState.askResponseText = undefined
				this.taskState.askResponseImages = undefined
				this.taskState.askResponseFiles = undefined

				/*
					Bug for the history books:
					In the webview we use the ts as the chatrow key for the virtuoso list. Since we would update this ts right at the end of streaming, it would cause the view to flicker. The key prop has to be stable otherwise react has trouble reconciling items between renders, causing unmounting and remounting of components (flickering).
					The lesson here is if you see flickering when rendering lists, it's likely because the key prop is not stable.
					So in this case we must make sure that the message ts is never altered after first setting it.
					*/
				askTs = lastMessage.ts
				this.taskState.lastMessageTs = askTs
				// lastMessage.ts = askTs
				await this.messageStateHandler.updateClineMessage(lastMessageIndex, {
					text,
					partial: false,
				})
				// await this.postStateToWebview()
				const protoMessage = convertClineMessageToProto(lastMessage)
				await sendPartialMessageEvent(protoMessage)
			} else {
				// this is a new partial=false message, so add it like normal
				this.taskState.askResponse = undefined
				this.taskState.askResponseText = undefined
				this.taskState.askResponseImages = undefined
				this.taskState.askResponseFiles = undefined
				askTs = Date.now()
				this.taskState.lastMessageTs = askTs
				await this.messageStateHandler.addToClineMessages({
					ts: askTs,
					type: "ask",
					ask: type,
					text,
				})
				await this.postStateToWebview()
			}
		} else {
			// this is a new non-partial message, so add it like normal
			// const lastMessage = this.clineMessages.at(-1)
			this.taskState.askResponse = undefined
			this.taskState.askResponseText = undefined
			this.taskState.askResponseImages = undefined
			this.taskState.askResponseFiles = undefined
			askTs = Date.now()
			this.taskState.lastMessageTs = askTs
			await this.messageStateHandler.addToClineMessages({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
			})
			await this.postStateToWebview()
		}

		await pWaitFor(() => this.taskState.askResponse !== undefined || this.taskState.lastMessageTs !== askTs, {
			interval: 100,
		})
		if (this.taskState.lastMessageTs !== askTs) {
			throw new Error("Current ask promise was ignored") // could happen if we send multiple asks in a row i.e. with command_output. It's important that when we know an ask could fail, it is handled gracefully
		}
		const result = {
			response: this.taskState.askResponse!,
			text: this.taskState.askResponseText,
			images: this.taskState.askResponseImages,
			files: this.taskState.askResponseFiles,
		}
		this.taskState.askResponse = undefined
		this.taskState.askResponseText = undefined
		this.taskState.askResponseImages = undefined
		this.taskState.askResponseFiles = undefined
		return result
	}

	async handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[], files?: string[]) {
		this.taskState.askResponse = askResponse
		this.taskState.askResponseText = text
		this.taskState.askResponseImages = images
		this.taskState.askResponseFiles = files
	}

	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
	): Promise<number | undefined> {
		// Allow hook messages even when aborted to enable proper cleanup
		if (this.taskState.abort && type !== "hook_status" && type !== "hook_output_stream") {
			throw new Error("Cline instance aborted")
		}

		const providerInfo = this.getCurrentProviderInfo()
		const modelInfo: ClineMessageModelInfo = {
			providerId: providerInfo.providerId,
			modelId: providerInfo.model.id,
			mode: providerInfo.mode,
		}

		if (partial !== undefined) {
			const lastMessage = this.messageStateHandler.getClineMessages().at(-1)
			const isUpdatingPreviousPartial = lastMessage?.partial && lastMessage?.type === "say" && lastMessage?.say === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					const lastIndex = this.messageStateHandler.getClineMessages().length - 1
					await this.messageStateHandler.updateClineMessage(lastIndex, {
						text,
						images,
						files,
						partial,
					})

					const protoMessage = convertClineMessageToProto(lastMessage)
					await sendPartialMessageEvent(protoMessage)
					return undefined
				}
				// this is a new partial message, so add it with partial state
				const sayTs = Date.now()
				this.taskState.lastMessageTs = sayTs
				await this.messageStateHandler.addToClineMessages({
					ts: sayTs,
					type: "say",
					say: type,
					text,
					images,
					files,
					partial,
					modelInfo,
				})
				await this.postStateToWebview()
				return sayTs
			}
			// partial=false means its a complete version of a previously partial message
			if (isUpdatingPreviousPartial) {
				// this is the complete version of a previously partial message, so replace the partial with the complete version
				this.taskState.lastMessageTs = lastMessage.ts
				const lastIndex = this.messageStateHandler.getClineMessages().length - 1
				// updateClineMessage emits the change event and saves to disk
				await this.messageStateHandler.updateClineMessage(lastIndex, {
					text,
					images,
					files,
					partial: false,
				})

				// await this.postStateToWebview()
				const protoMessage = convertClineMessageToProto(lastMessage)
				await sendPartialMessageEvent(protoMessage) // more performant than an entire postStateToWebview
				return undefined
			}
			// this is a new partial=false message, so add it like normal
			const sayTs = Date.now()
			this.taskState.lastMessageTs = sayTs
			await this.messageStateHandler.addToClineMessages({
				ts: sayTs,
				type: "say",
				say: type,
				text,
				images,
				files,
				modelInfo,
			})
			await this.postStateToWebview()
			return sayTs
		}
		// this is a new non-partial message, so add it like normal
		const sayTs = Date.now()
		this.taskState.lastMessageTs = sayTs
		await this.messageStateHandler.addToClineMessages({
			ts: sayTs,
			type: "say",
			say: type,
			text,
			images,
			files,
			modelInfo,
		})
		await this.postStateToWebview()
		return sayTs
	}

	/**
	 * Check if parallel tool calling is enabled.
	 * Parallel tool calling is enabled if:
	 * 1. User has enabled it in settings, OR
	 * 2. The current model/provider supports native tool calling and handles parallel tools well
	 */
	private isParallelToolCallingEnabled(): boolean {
		const enableParallelSetting = this.stateManager.getGlobalSettingsKey("enableParallelToolCalling")
		const providerInfo = this.getCurrentProviderInfo()
		return isParallelToolCallingEnabled(enableParallelSetting, providerInfo)
	}

	// Task lifecycle

	public async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
		try {
			await this.clineIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize ClineIgnoreController:", error)
			// Optionally, inform the user or handle the error appropriately
		}
		// conversationHistory (for API) and clineMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the clineMessages might not be empty, so we need to set it to [] when we create a new Cline client (otherwise webview would show stale messages from previous session)
		this.messageStateHandler.setClineMessages([])
		this.messageStateHandler.setApiConversationHistory([])

		await this.postStateToWebview()

		await this.say("task", task, images, files)

		this.taskState.isInitialized = true

		const imageBlocks: ClineImageContentBlock[] = formatResponse.imageBlocks(images)

		const userContent: ClineUserContent[] = [
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		]

		if (files && files.length > 0) {
			const fileContentString = await processFilesIntoText(files)
			if (fileContentString) {
				userContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		// Record environment metadata for new task
		try {
			await this.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata:", error)
		}

		await this.initiateTaskLoop(userContent, {
			phase: "initial_task",
			initialTask: task || "",
			userPromptHookContent: userContent,
		})
	}

	public async resumeTaskFromHistory() {
		try {
			await this.clineIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize ClineIgnoreController:", error)
			// Optionally, inform the user or handle the error appropriately
		}

		const savedClineMessages = await getSavedClineMessages(this.taskId)

		// Remove any resume messages that may have been added before

		const lastRelevantMessageIndex = findLastIndex(
			savedClineMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)
		if (lastRelevantMessageIndex !== -1) {
			savedClineMessages.splice(lastRelevantMessageIndex + 1)
		}

		// since we don't use api_req_finished anymore, we need to check if the last api_req_started has a cost value, if it doesn't and no cancellation reason to present, then we remove it since it indicates an api request without any partial content streamed
		const lastApiReqStartedIndex = findLastIndex(savedClineMessages, (m) => m.type === "say" && m.say === "api_req_started")
		if (lastApiReqStartedIndex !== -1) {
			const lastApiReqStarted = savedClineMessages[lastApiReqStartedIndex]
			const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")
			if (cost === undefined && cancelReason === undefined) {
				savedClineMessages.splice(lastApiReqStartedIndex, 1)
			}
		}

		await this.messageStateHandler.overwriteClineMessages(savedClineMessages)
		this.messageStateHandler.setClineMessages(await getSavedClineMessages(this.taskId))

		// Now present the cline messages to the user and ask if they want to resume (NOTE: we ran into a bug before where the apiconversationhistory wouldn't be initialized when opening a old task, and it was because we were waiting for resume)
		// This is important in case the user deletes messages without resuming the task first
		const savedApiConversationHistory = await getSavedApiConversationHistory(this.taskId)

		this.messageStateHandler.setApiConversationHistory(savedApiConversationHistory)

		// load the context history state
		await ensureTaskDirectoryExists(this.taskId)
		await this.contextManager.initializeContextHistory(await ensureTaskDirectoryExists(this.taskId))

		const lastClineMessage = this.messageStateHandler
			.getClineMessages()
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // could be multiple resume tasks

		let askType: ClineAsk
		if (lastClineMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else {
			askType = "resume_task"
		}

		this.taskState.isInitialized = true
		this.taskState.abort = false // Reset abort flag when resuming task

		const { response, text, images, files } = await this.ask(askType) // calls poststatetowebview

		const newUserContent: ClineContent[] = []
		const clineMessages = this.messageStateHandler.getClineMessages()

		let responseText: string | undefined
		let responseImages: string[] | undefined
		let responseFiles: string[] | undefined
		if (response === "messageResponse" || text || (images && images.length > 0) || (files && files.length > 0)) {
			await this.say("user_feedback", text, images, files)
			await this.checkpointManager?.saveCheckpoint()
			responseText = text
			responseImages = images
			responseFiles = files
		}

		// need to make sure that the api conversation history can be resumed by the api, even if it goes out of sync with cline messages

		// Use the already-loaded API conversation history from memory instead of reloading from disk
		// This prevents issues where the file might be empty or stale after hook execution
		const existingApiConversationHistory = this.messageStateHandler.getApiConversationHistory()

		// Remove the last user message so we can update it with the resume message
		let modifiedOldUserContent: ClineContent[] // either the last message if its user message, or the user message before the last (assistant) message
		let modifiedApiConversationHistory: ClineStorageMessage[] // need to remove the last user message to replace with new modified user message
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]
			if (lastMessage.role === "assistant") {
				modifiedApiConversationHistory = [...existingApiConversationHistory]
				modifiedOldUserContent = []
			} else if (lastMessage.role === "user") {
				const existingUserContent: ClineContent[] = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
				modifiedOldUserContent = [...existingUserContent]
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			// No API conversation history yet (e.g., cancelled during hook before first API request)
			// Start fresh with empty history and no previous content
			modifiedApiConversationHistory = []
			modifiedOldUserContent = []
		}

		// Add previous content to newUserContent array
		newUserContent.push(...modifiedOldUserContent)

		const agoText = (() => {
			const timestamp = lastClineMessage?.ts ?? Date.now()
			const now = Date.now()
			const diff = now - timestamp
			const minutes = Math.floor(diff / 60000)
			const hours = Math.floor(minutes / 60)
			const days = Math.floor(hours / 24)

			if (days > 0) {
				return `${days} day${days > 1 ? "s" : ""} ago`
			}
			if (hours > 0) {
				return `${hours} hour${hours > 1 ? "s" : ""} ago`
			}
			if (minutes > 0) {
				return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
			}
			return "just now"
		})()

		const wasRecent = lastClineMessage?.ts && Date.now() - lastClineMessage.ts < 30_000

		// Check if there are pending file context warnings before calling taskResumption
		const pendingContextWarning = await this.fileContextTracker.retrieveAndClearPendingFileContextWarning()
		const hasPendingFileContextWarnings = pendingContextWarning && pendingContextWarning.length > 0

		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const [taskResumptionMessage, userResponseMessage] = formatResponse.taskResumption(
			mode === "plan" ? "plan" : "act",
			agoText,
			this.cwd,
			wasRecent,
			responseText,
			hasPendingFileContextWarnings,
		)

		if (taskResumptionMessage !== "") {
			newUserContent.push({
				type: "text",
				text: taskResumptionMessage,
			})
		}

		if (userResponseMessage !== "") {
			newUserContent.push({
				type: "text",
				text: userResponseMessage,
			})
		}

		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...formatResponse.imageBlocks(responseImages))
		}

		if (responseFiles && responseFiles.length > 0) {
			const fileContentString = await processFilesIntoText(responseFiles)
			if (fileContentString) {
				newUserContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		// Inject file context warning if there were pending warnings from message editing
		if (pendingContextWarning && pendingContextWarning.length > 0) {
			const fileContextWarning = formatResponse.fileContextWarning(pendingContextWarning)
			newUserContent.push({
				type: "text",
				text: fileContextWarning,
			})
		}

		// Run UserPromptSubmit hook for task resumption with ONLY the new user feedback
		// (not the entire conversation context that includes previous messages)
		const userFeedbackContent = await buildUserFeedbackContent(responseText, responseImages, responseFiles)

		// Record environment metadata when resuming task (tracks cross-platform migrations)
		try {
			await this.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata on resume:", error)
		}

		await this.messageStateHandler.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.initiateTaskLoop(newUserContent, {
			phase: "resume",
			resumePreviousState: {
				lastMessageTs: lastClineMessage?.ts?.toString() || "",
				messageCount: clineMessages.length.toString(),
				conversationHistoryDeleted: (this.taskState.conversationHistoryDeletedRange !== undefined).toString(),
			},
			userPromptHookContent: userFeedbackContent,
		})
	}

	private async initiateTaskLoop(
		userContent: ClineContent[],
		runContext: Parameters<TaskAgentRuntime["run"]>[1],
	): Promise<void> {
		await this.taskAgentRuntime.run(userContent, runContext)
	}

	/**
	 * Determines if the TaskCancel hook should run.
	 * Only runs if there's actual active work happening or if work was started in this session.
	 * Does NOT run when just showing the resume button or completion button with no active work.
	 * @returns true if the hook should run, false otherwise
	 */
	private async shouldRunTaskCancelHook(): Promise<boolean> {
		// Atomically check for active hook execution (work happening now)
		const activeHook = await this.getActiveHookExecution()
		if (activeHook) {
			return true
		}

		// Run if the API is currently streaming (work happening now)
		if (this.taskState.isStreaming) {
			return true
		}

		// Run if we're waiting for the first chunk (work happening now)
		if (this.taskState.isWaitingForFirstChunk) {
			return true
		}

		// Run if there's active background command (work happening now)
		if (this.commandExecutor.hasActiveBackgroundCommand()) {
			return true
		}

		// Check if we're at a button-only state (no active work, just waiting for user action)
		const clineMessages = this.messageStateHandler.getClineMessages()
		const lastMessage = clineMessages.at(-1)
		const isAtButtonOnlyState =
			lastMessage?.type === "ask" &&
			(lastMessage.ask === "resume_task" ||
				lastMessage.ask === "resume_completed_task" ||
				lastMessage.ask === "completion_result")

		if (isAtButtonOnlyState) {
			// At button-only state - DON'T run hook because we're just waiting for user input
			// These button states appear when:
			// 1. Opening from history (resume_task/resume_completed_task)
			// 2. After task completion (completion_result with "Start New Task" button)
			// 3. After cancelling during active work (but work already stopped)
			// In all cases, we shouldn't run TaskCancel hook
			return false
		}

		// Not at a button-only state - we're in the middle of work or just finished something
		// Run the hook since cancelling would interrupt actual work
		return true
	}

	async abortTask() {
		try {
			// PHASE 1: Check if TaskCancel should run BEFORE any cleanup
			// We must capture this state now because subsequent cleanup will
			// clear the active work indicators that shouldRunTaskCancelHook checks
			const shouldRunTaskCancelHook = await this.shouldRunTaskCancelHook()

			// PHASE 2: Set abort flag to prevent race conditions
			// This must happen before canceling hooks so that hook catch blocks
			// can properly detect the abort state
			this.taskState.abort = true
			this.taskAgentRuntime.abort()

			// PHASE 3: Cancel any running hook execution
			const activeHook = await this.getActiveHookExecution()
			if (activeHook) {
				try {
					await this.cancelHookExecution()
					// Clear activeHookExecution after hook is signaled
					await this.clearActiveHookExecution()
				} catch (error) {
					Logger.error("Failed to cancel hook during task abort", error)
					// Still clear state even on error to prevent stuck state
					await this.clearActiveHookExecution()
				}
			}

			if (this.commandExecutor.hasActiveBackgroundCommand()) {
				try {
					await this.commandExecutor.cancelBackgroundCommand()
				} catch (error) {
					Logger.error("Failed to cancel background command during task abort", error)
				}
			}

			// PHASE 4: Run TaskCancel hook
			// This allows the hook UI to appear in the webview
			// Use the shouldRunTaskCancelHook value we captured in Phase 1
			if (shouldRunTaskCancelHook) {
				try {
					await this.taskHookAdapter.runTaskCancelHook({
						taskId: this.taskId,
						ulid: this.ulid,
						completionStatus: this.taskState.abandoned ? "abandoned" : "cancelled",
					})

					// TaskCancel completed successfully
					// Present resume button after successful TaskCancel hook
					const lastClineMessage = this.messageStateHandler
						.getClineMessages()
						.slice()
						.reverse()
						.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

					let askType: ClineAsk
					if (lastClineMessage?.ask === "completion_result") {
						askType = "resume_completed_task"
					} else {
						askType = "resume_task"
					}

					// Present the resume ask - this will show the resume button in the UI
					// We don't await this because we want to set the abort flag immediately
					// The ask will be waiting when the user decides to resume
					this.ask(askType).catch((error) => {
						// If ask fails (e.g., task was cleared), that's okay - just log it
						Logger.log("[TaskCancel] Resume ask failed (task may have been cleared):", error)
					})
				} catch (error) {
					// TaskCancel hook failed - non-fatal, just log
					Logger.error("[TaskCancel Hook] Failed (non-fatal):", error)
				}
			}

			// PHASE 5: Immediately update UI to reflect abort state
			try {
				await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
				await this.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post state after setting abort flag", error)
			}

			// PHASE 7: Clean up resources
			this.terminalManager.disposeAll()
			this.urlContentFetcher.closeBrowser()
			await this.browserSession.dispose()
			this.clineIgnoreController.dispose()
			this.fileContextTracker.dispose()
			// need to await for when we want to make sure directories/files are reverted before
			// re-starting the task from a checkpoint
			await this.diffViewProvider.revertChanges()
			// Clear the notification callback when task is aborted
			this.mcpHub.clearNotificationCallback()
		} finally {
			// Release task folder lock
			if (this.taskLockAcquired) {
				try {
					await releaseTaskLock(this.taskId)
					this.taskLockAcquired = false
					Logger.info(`[Task ${this.taskId}] Task lock released`)
				} catch (error) {
					Logger.error(`[Task ${this.taskId}] Failed to release task lock:`, error)
				}
			}

			// Final state update to notify UI that abort is complete
			try {
				await this.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post final state after abort", error)
			}
		}
	}

	// Tools
	async executeCommandTool(
		command: string,
		timeoutSeconds: number | undefined,
		options?: CommandExecutionOptions,
	): Promise<[boolean, ClineToolResponseContent]> {
		return this.commandExecutor.execute(command, timeoutSeconds, options)
	}

	/**
	 * Cancel a background command that is running in the background
	 * @returns true if a command was cancelled, false if no command was running
	 */
	public async cancelBackgroundCommand(): Promise<boolean> {
		return this.commandExecutor.cancelBackgroundCommand()
	}

	/**
	 * Cancel a currently running hook execution
	 * @returns true if a hook was cancelled, false if no hook was running
	 */
	public async cancelHookExecution(): Promise<boolean> {
		return await this.taskHookAdapter.cancelHookExecution((message, error) => Logger.error(message, error))
	}

	private getCurrentProviderInfo(): ApiProviderInfo {
		const model = this.coreAgent.getModel()
		const apiConfig = this.stateManager.getApiConfiguration()
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const providerId = (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const customPrompt = this.stateManager.getGlobalSettingsKey("customPrompt")
		return { model, providerId, customPrompt, mode }
	}

	private async writePromptMetadataArtifacts(params: { systemPrompt: string; providerInfo: ApiProviderInfo }): Promise<void> {
		const enabledFlag = process.env.CLINE_WRITE_PROMPT_ARTIFACTS?.toLowerCase()
		const enabled = enabledFlag === "1" || enabledFlag === "true" || enabledFlag === "yes"
		if (!enabled) {
			return
		}

		try {
			const configuredDir = process.env.CLINE_PROMPT_ARTIFACT_DIR?.trim()
			const artifactDir = configuredDir
				? path.isAbsolute(configuredDir)
					? configuredDir
					: path.resolve(this.cwd, configuredDir)
				: path.resolve(this.cwd, ".cline-prompt-artifacts")

			await fs.mkdir(artifactDir, { recursive: true })

			const ts = new Date().toISOString()
			const safeTs = ts.replace(/[:.]/g, "-")
			const baseName = `task-${this.taskId}-req-${this.taskState.apiRequestCount}-${safeTs}`
			const manifestPath = path.join(artifactDir, `${baseName}.manifest.json`)
			const promptPath = path.join(artifactDir, `${baseName}.system_prompt.md`)

			const manifest = {
				taskId: this.taskId,
				ulid: this.ulid,
				apiRequestCount: this.taskState.apiRequestCount,
				ts,
				cwd: this.cwd,
				mode: params.providerInfo.mode,
				provider: params.providerInfo.providerId,
				model: params.providerInfo.model.id,
				apiRequestId: this.getApiRequestIdSafe(),
				systemPromptPath: promptPath,
			}

			await Promise.all([
				fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
				fs.writeFile(promptPath, params.systemPrompt, "utf8"),
			])
		} catch (error) {
			Logger.error("Failed to write prompt metadata artifacts:", error)
		}
	}

	private getApiRequestIdSafe(): string | undefined {
		return this.coreAgent.getLastRequestIdSafe()
	}

	// Legacy stream-loop internals removed in phase 3.
	// Task loop execution now lives in TaskAgentRuntime (@cline/agents).
	async loadContext(
		userContent: ClineContent[],
		includeFileDetails = false,
		useCompactPrompt = false,
	): Promise<[ClineContent[], string, boolean]> {
		return [userContent, "", false]
	}

	/**
	 * Format workspace roots section for multi-root workspaces
	 */
	public formatWorkspaceRootsSection(): string {
		const multiRootEnabled = isMultiRootEnabled(this.stateManager)
		const roots = this.workspaceManager?.getRoots() || []

		// Only show workspace roots if multi-root is enabled and there are multiple roots
		if (!multiRootEnabled || roots.length <= 1) {
			return ""
		}

		let section = "\n\n# Workspace Roots"

		// Format each root with its name, path, and VCS info
		for (const root of roots) {
			const name = root.name || path.basename(root.path)
			const vcs = root.vcs ? ` (${String(root.vcs)})` : ""
			section += `\n- ${name}: ${root.path}${vcs}`
		}

		// Add primary workspace information
		const primary = this.workspaceManager?.getPrimaryRoot()
		const primaryName = this.getPrimaryWorkspaceName(primary)
		section += `\n\nPrimary workspace: ${primaryName}`

		return section
	}

	/**
	 * Get the display name for the primary workspace
	 */
	private getPrimaryWorkspaceName(primary?: ReturnType<WorkspaceRootManager["getRoots"]>[0]): string {
		if (primary?.name) {
			return primary.name
		}
		if (primary?.path) {
			return path.basename(primary.path)
		}
		return path.basename(this.cwd)
	}
}
