import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, buildApiHandler } from "@api/index"
import { AnthropicHandler } from "@api/providers/anthropic"
import { ClineHandler } from "@api/providers/cline"
import { OpenRouterHandler } from "@api/providers/openrouter"
import { ApiStream } from "@api/transform/stream"
import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { formatContentBlockToMarkdown } from "@integrations/misc/export-markdown"
import { showSystemNotification } from "@integrations/notifications"
import { TerminalManager } from "@integrations/terminal/TerminalManager"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { listFiles } from "@services/glob/list-files"
import { Logger } from "@services/logging/Logger"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { ApiConfiguration } from "@shared/api"
import { findLast, findLastIndex } from "@shared/array"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { BrowserSettings } from "@shared/BrowserSettings"
import { ChatSettings } from "@shared/ChatSettings"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { ClineApiReqCancelReason, ClineApiReqInfo, ClineAsk, ClineMessage, ClineSay } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, LanguageDisplay } from "@shared/Languages"
import { ClineAskResponse, ClineCheckpointRestore } from "@shared/WebviewMessage"
import { getGitRemoteUrls } from "@utils/git"
import { arePathsEqual, getDesktopDir } from "@utils/path"
import cloneDeep from "clone-deep"
import { execa } from "execa"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import pTimeout from "p-timeout"
import pWaitFor from "p-wait-for"
import * as path from "path"
import * as vscode from "vscode"

import { parseAssistantMessageV2, parseAssistantMessageV3, ToolUseName } from "@core/assistant-message"
import {
	checkIsAnthropicContextWindowError,
	checkIsOpenRouterContextWindowError,
} from "@core/context/context-management/context-error-handling"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ModelContextTracker } from "@core/context/context-tracking/ModelContextTracker"
import {
	getGlobalClineRules,
	getLocalClineRules,
	refreshClineRulesToggles,
} from "@core/context/instructions/user-instructions/cline-rules"
import {
	getLocalCursorRules,
	getLocalWindsurfRules,
	refreshExternalRulesToggles,
} from "@core/context/instructions/user-instructions/external-rules"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import { sendRelinquishControlEvent } from "@core/controller/ui/subscribeToRelinquishControl"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { parseMentions } from "@core/mentions"
import { formatResponse } from "@core/prompts/responses"
import { addUserInstructions, SYSTEM_PROMPT } from "@core/prompts/system"
import { parseSlashCommands } from "@core/slash-commands"
import {
	ensureRulesDirectoryExists,
	ensureTaskDirectoryExists,
	getSavedApiConversationHistory,
	getSavedClineMessages,
	GlobalFileNames,
} from "@core/storage/disk"
import { getGlobalState } from "@core/storage/state"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import WorkspaceTracker from "@integrations/workspace/WorkspaceTracker"
import { McpHub } from "@services/mcp/McpHub"
import { convertClineMessageToProto } from "@shared/proto-conversions/cline-message"
import { isClaude4ModelFamily, isGemini2dot5ModelFamily } from "@utils/model-utils"
import { isInTestMode } from "../../services/test/TestMode"
import { ensureLocalClineDirExists } from "../context/instructions/user-instructions/rule-helpers"
import { refreshWorkflowToggles } from "../context/instructions/user-instructions/workflows"
import { MessageStateHandler } from "./message-state"
import { TaskState } from "./TaskState"
import { ToolExecutor } from "./ToolExecutor"
import { formatErrorWithStatusCode, updateApiReqMsg } from "./utils"

export const USE_EXPERIMENTAL_CLAUDE4_FEATURES = false

export type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>
type UserContent = Array<Anthropic.ContentBlockParam>

export class Task {
	// Core task variables
	readonly taskId: string
	private taskIsFavorited?: boolean
	private cwd: string

	taskState: TaskState

	// Task configuration
	private enableCheckpoints: boolean

	// Core dependencies
	private context: vscode.ExtensionContext
	private mcpHub: McpHub
	private workspaceTracker: WorkspaceTracker

	// Service handlers
	api: ApiHandler
	terminalManager: TerminalManager
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	contextManager: ContextManager
	private diffViewProvider: DiffViewProvider
	private checkpointTracker?: CheckpointTracker
	private clineIgnoreController: ClineIgnoreController
	private toolExecutor: ToolExecutor

	// Metadata tracking
	private fileContextTracker: FileContextTracker
	private modelContextTracker: ModelContextTracker

	// Callbacks
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private postStateToWebview: () => Promise<void>
	private reinitExistingTaskFromId: (taskId: string) => Promise<void>
	private cancelTask: () => Promise<void>

	// User chat state
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	chatSettings: ChatSettings

	// Message and conversation state
	messageStateHandler: MessageStateHandler
	constructor(
		context: vscode.ExtensionContext,
		mcpHub: McpHub,
		workspaceTracker: WorkspaceTracker,
		updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>,
		postStateToWebview: () => Promise<void>,
		reinitExistingTaskFromId: (taskId: string) => Promise<void>,
		cancelTask: () => Promise<void>,
		apiConfiguration: ApiConfiguration,
		autoApprovalSettings: AutoApprovalSettings,
		browserSettings: BrowserSettings,
		chatSettings: ChatSettings,
		shellIntegrationTimeout: number,
		terminalReuseEnabled: boolean,
		terminalOutputLineLimit: number,
		defaultTerminalProfile: string,
		enableCheckpointsSetting: boolean,
		cwd: string,
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
	) {
		this.taskState = new TaskState()
		this.context = context
		this.mcpHub = mcpHub
		this.workspaceTracker = workspaceTracker
		this.updateTaskHistory = updateTaskHistory
		this.postStateToWebview = postStateToWebview
		this.reinitExistingTaskFromId = reinitExistingTaskFromId
		this.cancelTask = cancelTask
		this.clineIgnoreController = new ClineIgnoreController(cwd)
		// Initialization moved to startTask/resumeTaskFromHistory
		this.terminalManager = new TerminalManager()
		this.terminalManager.setShellIntegrationTimeout(shellIntegrationTimeout)
		this.terminalManager.setTerminalReuseEnabled(terminalReuseEnabled ?? true)
		this.terminalManager.setTerminalOutputLineLimit(terminalOutputLineLimit)
		this.terminalManager.setDefaultTerminalProfile(defaultTerminalProfile)

		this.urlContentFetcher = new UrlContentFetcher(context)
		this.browserSession = new BrowserSession(context, browserSettings)
		this.contextManager = new ContextManager()
		this.diffViewProvider = new DiffViewProvider(cwd)
		this.autoApprovalSettings = autoApprovalSettings
		this.browserSettings = browserSettings
		this.chatSettings = chatSettings
		this.enableCheckpoints = enableCheckpointsSetting
		this.cwd = cwd

		// Set up MCP notification callback for real-time notifications
		this.mcpHub.setNotificationCallback(async (serverName: string, level: string, message: string) => {
			// Display notification in chat immediately
			await this.say("mcp_notification", `[${serverName}] ${message}`)
		})

		// Initialize taskId first
		if (historyItem) {
			this.taskId = historyItem.id
			this.taskIsFavorited = historyItem.isFavorited
			this.taskState.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
		} else if (task || images || files) {
			this.taskId = Date.now().toString()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.messageStateHandler = new MessageStateHandler({
			context,
			taskId: this.taskId,
			taskState: this.taskState,
			taskIsFavorited: this.taskIsFavorited,
			updateTaskHistory: this.updateTaskHistory,
		})

		// Initialize file context tracker
		this.fileContextTracker = new FileContextTracker(context, this.taskId)
		this.modelContextTracker = new ModelContextTracker(context, this.taskId)

		// Prepare effective API configuration
		let effectiveApiConfiguration: ApiConfiguration = {
			...apiConfiguration,
			taskId: this.taskId,
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
							console.error("Error posting state to webview in onRetryAttempt:", e),
						)

						console.log(
							`[Task ${this.taskId}] API Auto-Retry Status Update: Attempt ${attempt}/${maxRetries}, Delay: ${delay}ms`,
						)
					} catch (e) {
						console.error(`[Task ${this.taskId}] Error updating api_req_started with retryStatus:`, e)
					}
				}
			},
		}

		if (apiConfiguration.apiProvider === "openai" || apiConfiguration.apiProvider === "openai-native") {
			effectiveApiConfiguration.reasoningEffort = chatSettings.openAIReasoningEffort
		}

		// Now that taskId is initialized, we can build the API handler
		this.api = buildApiHandler(effectiveApiConfiguration)

		// Set taskId on browserSession for telemetry tracking
		this.browserSession.setTaskId(this.taskId)

		// Continue with task initialization
		if (historyItem) {
			this.resumeTaskFromHistory()
		} else if (task || images || files) {
			this.startTask(task, images, files)
		}

		// initialize telemetry
		if (historyItem) {
			// Open task from history
			telemetryService.captureTaskRestarted(this.taskId, apiConfiguration.apiProvider)
		} else {
			// New task started
			telemetryService.captureTaskCreated(this.taskId, apiConfiguration.apiProvider)
		}

		this.toolExecutor = new ToolExecutor(
			this.context,
			this.taskState,
			this.messageStateHandler,
			this.api,
			this.urlContentFetcher,
			this.browserSession,
			this.diffViewProvider,
			this.mcpHub,
			this.fileContextTracker,
			this.clineIgnoreController,
			this.workspaceTracker,
			this.contextManager,
			this.autoApprovalSettings,
			this.browserSettings,
			cwd,
			this.taskId,
			this.say.bind(this),
			this.ask.bind(this),
			this.saveCheckpoint.bind(this),
			this.sayAndCreateMissingParamError.bind(this),
			this.removeLastPartialMessageIfExistsWithType.bind(this),
			this.executeCommandTool.bind(this),
			this.doesLatestTaskCompletionHaveNewChanges.bind(this),
		)
	}

	// While a task is ref'd by a controller, it will always have access to the extension context
	// This error is thrown if the controller derefs the task after e.g., aborting the task
	private getContext(): vscode.ExtensionContext {
		const context = this.context
		if (!context) {
			throw new Error("Unable to access extension context")
		}
		return context
	}

	/**
	 * Updates the auto approval settings for this task
	 */
	public updateAutoApprovalSettings(settings: AutoApprovalSettings): void {
		this.toolExecutor.updateAutoApprovalSettings(settings)
	}

	async restoreCheckpoint(messageTs: number, restoreType: ClineCheckpointRestore, offset?: number) {
		const clineMessages = this.messageStateHandler.getClineMessages()
		const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs) - (offset || 0)
		// Find the last message before messageIndex that has a lastCheckpointHash
		const lastHashIndex = findLastIndex(clineMessages.slice(0, messageIndex), (m) => m.lastCheckpointHash !== undefined)
		const message = clineMessages[messageIndex]
		const lastMessageWithHash = clineMessages[lastHashIndex]

		if (!message) {
			console.error("Message not found", clineMessages)
			return
		}

		let didWorkspaceRestoreFail = false

		switch (restoreType) {
			case "task":
				break
			case "taskAndWorkspace":
			case "workspace":
				if (!this.enableCheckpoints) {
					vscode.window.showErrorMessage("Checkpoints are disabled in settings.")
					didWorkspaceRestoreFail = true
					break
				}

				if (!this.checkpointTracker && !this.taskState.checkpointTrackerErrorMessage) {
					try {
						this.checkpointTracker = await CheckpointTracker.create(
							this.taskId,
							this.context.globalStorageUri.fsPath,
							this.enableCheckpoints,
						)
						this.messageStateHandler.setCheckpointTracker(this.checkpointTracker)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						console.error("Failed to initialize checkpoint tracker:", errorMessage)
						this.taskState.checkpointTrackerErrorMessage = errorMessage
						await this.postStateToWebview()
						vscode.window.showErrorMessage(errorMessage)
						didWorkspaceRestoreFail = true
					}
				}
				if (message.lastCheckpointHash && this.checkpointTracker) {
					try {
						await this.checkpointTracker.resetHead(message.lastCheckpointHash)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						vscode.window.showErrorMessage("Failed to restore checkpoint: " + errorMessage)
						didWorkspaceRestoreFail = true
					}
				} else if (offset && lastMessageWithHash.lastCheckpointHash && this.checkpointTracker) {
					try {
						await this.checkpointTracker.resetHead(lastMessageWithHash.lastCheckpointHash)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						vscode.window.showErrorMessage("Failed to restore offsetcheckpoint: " + errorMessage)
						didWorkspaceRestoreFail = true
					}
				} else if (!offset && lastMessageWithHash.lastCheckpointHash && this.checkpointTracker) {
					// Fallback: restore to most recent checkpoint when target message has no checkpoint hash
					console.warn(`Message ${messageTs} has no checkpoint hash, falling back to previous checkpoint`)
					try {
						await this.checkpointTracker.resetHead(lastMessageWithHash.lastCheckpointHash)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						vscode.window.showErrorMessage("Failed to restore checkpoint: " + errorMessage)
						didWorkspaceRestoreFail = true
					}
				} else {
					vscode.window.showErrorMessage("Failed to restore checkpoint")
				}
				break
		}

		if (!didWorkspaceRestoreFail) {
			switch (restoreType) {
				case "task":
				case "taskAndWorkspace":
					this.taskState.conversationHistoryDeletedRange = message.conversationHistoryDeletedRange
					const apiConversationHistory = this.messageStateHandler.getApiConversationHistory()
					const newConversationHistory = apiConversationHistory.slice(0, (message.conversationHistoryIndex || 0) + 2) // +1 since this index corresponds to the last user message, and another +1 since slice end index is exclusive
					await this.messageStateHandler.overwriteApiConversationHistory(newConversationHistory)

					// update the context history state
					await this.contextManager.truncateContextHistory(
						message.ts,
						await ensureTaskDirectoryExists(this.getContext(), this.taskId),
					)

					// aggregate deleted api reqs info so we don't lose costs/tokens
					const clineMessages = this.messageStateHandler.getClineMessages()
					const deletedMessages = clineMessages.slice(messageIndex + 1)
					const deletedApiReqsMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(deletedMessages)))

					// Detect files edited after this message timestamp for file context warning
					// Only needed for task-only restores when a user edits a message or restores the task context, but not the files.
					if (restoreType === "task") {
						const filesEditedAfterMessage = await this.fileContextTracker.detectFilesEditedAfterMessage(
							messageTs,
							deletedMessages,
						)
						if (filesEditedAfterMessage.length > 0) {
							await this.fileContextTracker.storePendingFileContextWarning(filesEditedAfterMessage)
						}
					}

					const newClineMessages = clineMessages.slice(0, messageIndex + 1)
					await this.messageStateHandler.overwriteClineMessages(newClineMessages) // calls saveClineMessages which saves historyItem

					await this.say(
						"deleted_api_reqs",
						JSON.stringify({
							tokensIn: deletedApiReqsMetrics.totalTokensIn,
							tokensOut: deletedApiReqsMetrics.totalTokensOut,
							cacheWrites: deletedApiReqsMetrics.totalCacheWrites,
							cacheReads: deletedApiReqsMetrics.totalCacheReads,
							cost: deletedApiReqsMetrics.totalCost,
						} satisfies ClineApiReqInfo),
					)
					break
				case "workspace":
					break
			}

			switch (restoreType) {
				case "task":
					vscode.window.showInformationMessage("Task messages have been restored to the checkpoint")
					break
				case "workspace":
					vscode.window.showInformationMessage("Workspace files have been restored to the checkpoint")
					break
				case "taskAndWorkspace":
					vscode.window.showInformationMessage("Task and workspace have been restored to the checkpoint")
					break
			}

			if (restoreType !== "task") {
				// Set isCheckpointCheckedOut flag on the message
				// Find all checkpoint messages before this one
				const checkpointMessages = this.messageStateHandler
					.getClineMessages()
					.filter((m) => m.say === "checkpoint_created")
				const currentMessageIndex = checkpointMessages.findIndex((m) => m.ts === messageTs)

				// Set isCheckpointCheckedOut to false for all checkpoint messages
				checkpointMessages.forEach((m, i) => {
					m.isCheckpointCheckedOut = i === currentMessageIndex
				})
			}

			await this.messageStateHandler.saveClineMessagesAndUpdateHistory()

			this.cancelTask() // the task is already cancelled by the provider beforehand, but we need to re-init to get the updated messages
		} else {
			sendRelinquishControlEvent()
		}
	}

	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean) {
		const relinquishButton = () => {
			sendRelinquishControlEvent()
		}
		if (!this.enableCheckpoints) {
			vscode.window.showInformationMessage("Checkpoints are disabled in settings. Cannot show diff.")
			relinquishButton()
			return
		}

		console.log("presentMultifileDiff", messageTs)
		const clineMessages = this.messageStateHandler.getClineMessages()
		const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs)
		const message = clineMessages[messageIndex]
		if (!message) {
			console.error("Message not found")
			relinquishButton()
			return
		}
		const hash = message.lastCheckpointHash
		if (!hash) {
			console.error("No checkpoint hash found")
			relinquishButton()
			return
		}

		// TODO: handle if this is called from outside original workspace, in which case we need to show user error message we can't show diff outside of workspace?
		if (!this.checkpointTracker && this.enableCheckpoints && !this.taskState.checkpointTrackerErrorMessage) {
			try {
				this.checkpointTracker = await CheckpointTracker.create(
					this.taskId,
					this.context.globalStorageUri.fsPath,
					this.enableCheckpoints,
				)
				this.messageStateHandler.setCheckpointTracker(this.checkpointTracker)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				this.taskState.checkpointTrackerErrorMessage = errorMessage
				await this.postStateToWebview()
				vscode.window.showErrorMessage(errorMessage)
				relinquishButton()
				return
			}
		}

		let changedFiles:
			| {
					relativePath: string
					absolutePath: string
					before: string
					after: string
			  }[]
			| undefined

		try {
			if (seeNewChangesSinceLastTaskCompletion) {
				// Get last task completed
				const lastTaskCompletedMessageCheckpointHash = findLast(
					this.messageStateHandler.getClineMessages().slice(0, messageIndex),
					(m) => m.say === "completion_result",
				)?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about
				// if undefined, then we get diff from beginning of git
				// if (!lastTaskCompletedMessage) {
				// 	console.error("No previous task completion message found")
				// 	return
				// }
				// This value *should* always exist
				const firstCheckpointMessageCheckpointHash = this.messageStateHandler
					.getClineMessages()
					.find((m) => m.say === "checkpoint_created")?.lastCheckpointHash

				const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash // either use the diff between the first checkpoint and the task completion, or the diff between the latest two task completions

				if (!previousCheckpointHash) {
					vscode.window.showErrorMessage("Unexpected error: No checkpoint hash found")
					relinquishButton()
					return
				}

				// Get changed files between current state and commit
				changedFiles = await this.checkpointTracker?.getDiffSet(previousCheckpointHash, hash)
				if (!changedFiles?.length) {
					vscode.window.showInformationMessage("No changes found")
					relinquishButton()
					return
				}
			} else {
				// Get changed files between current state and commit
				changedFiles = await this.checkpointTracker?.getDiffSet(hash)
				if (!changedFiles?.length) {
					vscode.window.showInformationMessage("No changes found")
					relinquishButton()
					return
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			vscode.window.showErrorMessage("Failed to retrieve diff set: " + errorMessage)
			relinquishButton()
			return
		}

		// Check if multi-diff editor is enabled in VS Code settings
		// const config = vscode.workspace.getConfiguration()
		// const isMultiDiffEnabled = config.get("multiDiffEditor.experimental.enabled")

		// if (!isMultiDiffEnabled) {
		// 	vscode.window.showErrorMessage(
		// 		"Please enable 'multiDiffEditor.experimental.enabled' in your VS Code settings to use this feature.",
		// 	)
		// 	relinquishButton()
		// 	return
		// }
		// Open multi-diff editor
		await vscode.commands.executeCommand(
			"vscode.changes",
			seeNewChangesSinceLastTaskCompletion ? "New changes" : "Changes since snapshot",
			changedFiles.map((file) => [
				vscode.Uri.file(file.absolutePath),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${file.relativePath}`).with({
					query: Buffer.from(file.before ?? "").toString("base64"),
				}),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${file.relativePath}`).with({
					query: Buffer.from(file.after ?? "").toString("base64"),
				}),
			]),
		)
		relinquishButton()
	}

	async doesLatestTaskCompletionHaveNewChanges() {
		if (!this.enableCheckpoints) {
			return false
		}

		const clineMessages = this.messageStateHandler.getClineMessages()
		const messageIndex = findLastIndex(clineMessages, (m) => m.say === "completion_result")
		const message = clineMessages[messageIndex]
		if (!message) {
			console.error("Completion message not found")
			return false
		}
		const hash = message.lastCheckpointHash
		if (!hash) {
			console.error("No checkpoint hash found")
			return false
		}

		if (this.enableCheckpoints && !this.checkpointTracker && !this.taskState.checkpointTrackerErrorMessage) {
			try {
				this.checkpointTracker = await CheckpointTracker.create(
					this.taskId,
					this.context.globalStorageUri.fsPath,
					this.enableCheckpoints,
				)
				this.messageStateHandler.setCheckpointTracker(this.checkpointTracker)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				return false
			}
		}

		// Get last task completed
		const lastTaskCompletedMessage = findLast(
			this.messageStateHandler.getClineMessages().slice(0, messageIndex),
			(m) => m.say === "completion_result",
		)

		try {
			// Get last task completed
			const lastTaskCompletedMessageCheckpointHash = lastTaskCompletedMessage?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about
			// if undefined, then we get diff from beginning of git
			// if (!lastTaskCompletedMessage) {
			// 	console.error("No previous task completion message found")
			// 	return
			// }
			// This value *should* always exist
			const firstCheckpointMessageCheckpointHash = this.messageStateHandler
				.getClineMessages()
				.find((m) => m.say === "checkpoint_created")?.lastCheckpointHash

			const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash // either use the diff between the first checkpoint and the task completion, or the diff between the latest two task completions

			if (!previousCheckpointHash) {
				return false
			}

			// Get count of changed files between current state and commit
			const changedFilesCount = (await this.checkpointTracker?.getDiffCount(previousCheckpointHash, hash)) || 0
			if (changedFilesCount > 0) {
				return true
			}
		} catch (error) {
			console.error("Failed to get diff set:", error)
			return false
		}

		return false
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
	}> {
		// If this Cline instance was aborted by the provider, then the only thing keeping us alive is a promise still running in the background, in which case we don't want to send its result to the webview as it is attached to a new instance of Cline now. So we can safely ignore the result of any active promises, and this class will be deallocated. (Although we set Cline = undefined in provider, that simply removes the reference to this instance, but the instance is still alive until this promise resolves or rejects.)
		if (this.taskState.abort) {
			throw new Error("Cline instance aborted")
		}
		let askTs: number
		if (partial !== undefined) {
			const clineMessages = this.messageStateHandler.getClineMessages()
			const lastMessage = clineMessages.at(-1)
			const lastMessageIndex = clineMessages.length - 1
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type
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
				} else {
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
			} else {
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

	async say(type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean): Promise<undefined> {
		if (this.taskState.abort) {
			throw new Error("Cline instance aborted")
		}

		if (partial !== undefined) {
			const lastMessage = this.messageStateHandler.getClineMessages().at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files
					lastMessage.partial = partial
					const protoMessage = convertClineMessageToProto(lastMessage)
					await sendPartialMessageEvent(protoMessage)
				} else {
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
					})
					await this.postStateToWebview()
				}
			} else {
				// partial=false means its a complete version of a previously partial message
				if (isUpdatingPreviousPartial) {
					// this is the complete version of a previously partial message, so replace the partial with the complete version
					this.taskState.lastMessageTs = lastMessage.ts
					// lastMessage.ts = sayTs
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files // Ensure files is updated
					lastMessage.partial = false

					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
					// await this.postStateToWebview()
					const protoMessage = convertClineMessageToProto(lastMessage)
					await sendPartialMessageEvent(protoMessage) // more performant than an entire postStateToWebview
				} else {
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
					})
					await this.postStateToWebview()
				}
			}
		} else {
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
			})
			await this.postStateToWebview()
		}
	}

	async sayAndCreateMissingParamError(toolName: ToolUseName, paramName: string, relPath?: string) {
		await this.say(
			"error",
			`Cline tried to use ${toolName}${
				relPath ? ` for '${relPath.toPosix()}'` : ""
			} without value for required parameter '${paramName}'. Retrying...`,
		)
		return formatResponse.toolError(formatResponse.missingToolParameterError(paramName))
	}

	async removeLastPartialMessageIfExistsWithType(type: "ask" | "say", askOrSay: ClineAsk | ClineSay) {
		const clineMessages = this.messageStateHandler.getClineMessages()
		const lastMessage = clineMessages.at(-1)
		if (lastMessage?.partial && lastMessage.type === type && (lastMessage.ask === askOrSay || lastMessage.say === askOrSay)) {
			this.messageStateHandler.setClineMessages(clineMessages.slice(0, -1))
			await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
		}
	}

	// Task lifecycle

	private async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
		try {
			await this.clineIgnoreController.initialize()
		} catch (error) {
			console.error("Failed to initialize ClineIgnoreController:", error)
			// Optionally, inform the user or handle the error appropriately
		}
		// conversationHistory (for API) and clineMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the clineMessages might not be empty, so we need to set it to [] when we create a new Cline client (otherwise webview would show stale messages from previous session)
		this.messageStateHandler.setClineMessages([])
		this.messageStateHandler.setApiConversationHistory([])

		await this.postStateToWebview()

		await this.say("text", task, images, files)

		this.taskState.isInitialized = true

		let imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)

		let userContent: UserContent = [
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

		await this.initiateTaskLoop(userContent)
	}

	private async resumeTaskFromHistory() {
		try {
			await this.clineIgnoreController.initialize()
		} catch (error) {
			console.error("Failed to initialize ClineIgnoreController:", error)
			// Optionally, inform the user or handle the error appropriately
		}
		// UPDATE: we don't need this anymore since most tasks are now created with checkpoints enabled
		// right now we let users init checkpoints for old tasks, assuming they're continuing them from the same workspace (which we never tied to tasks, so no way for us to know if it's opened in the right workspace)
		// const doesShadowGitExist = await CheckpointTracker.doesShadowGitExist(this.taskId, this.controllerRef.deref())
		// if (!doesShadowGitExist) {
		// 	this.checkpointTrackerErrorMessage = "Checkpoints are only available for new tasks"
		// }

		const savedClineMessages = await getSavedClineMessages(this.getContext(), this.taskId)

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
		this.messageStateHandler.setClineMessages(await getSavedClineMessages(this.getContext(), this.taskId))

		// Now present the cline messages to the user and ask if they want to resume (NOTE: we ran into a bug before where the apiconversationhistory wouldn't be initialized when opening a old task, and it was because we were waiting for resume)
		// This is important in case the user deletes messages without resuming the task first
		const context = this.getContext()
		const savedApiConversationHistory = await getSavedApiConversationHistory(context, this.taskId)
		this.messageStateHandler.setApiConversationHistory(savedApiConversationHistory)

		// load the context history state

		const taskDir = await ensureTaskDirectoryExists(context, this.taskId)
		await this.contextManager.initializeContextHistory(await ensureTaskDirectoryExists(this.getContext(), this.taskId))

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

		const { response, text, images, files } = await this.ask(askType) // calls poststatetowebview
		let responseText: string | undefined
		let responseImages: string[] | undefined
		let responseFiles: string[] | undefined
		if (response === "messageResponse") {
			await this.say("user_feedback", text, images, files)
			await this.saveCheckpoint()
			responseText = text
			responseImages = images
			responseFiles = files
		}

		// need to make sure that the api conversation history can be resumed by the api, even if it goes out of sync with cline messages

		const existingApiConversationHistory: Anthropic.Messages.MessageParam[] = await getSavedApiConversationHistory(
			this.getContext(),
			this.taskId,
		)

		// Remove the last user message so we can update it with the resume message
		let modifiedOldUserContent: UserContent // either the last message if its user message, or the user message before the last (assistant) message
		let modifiedApiConversationHistory: Anthropic.Messages.MessageParam[] // need to remove the last user message to replace with new modified user message
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]
			if (lastMessage.role === "assistant") {
				modifiedApiConversationHistory = [...existingApiConversationHistory]
				modifiedOldUserContent = []
			} else if (lastMessage.role === "user") {
				const existingUserContent: UserContent = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
				modifiedOldUserContent = [...existingUserContent]
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			throw new Error("Unexpected: No existing API conversation history")
		}

		let newUserContent: UserContent = [...modifiedOldUserContent]

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

		const [taskResumptionMessage, userResponseMessage] = formatResponse.taskResumption(
			this.chatSettings?.mode === "plan" ? "plan" : "act",
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

		await this.messageStateHandler.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.initiateTaskLoop(newUserContent)
	}

	private async initiateTaskLoop(userContent: UserContent): Promise<void> {
		let nextUserContent = userContent
		let includeFileDetails = true
		while (!this.taskState.abort) {
			const didEndLoop = await this.recursivelyMakeClineRequests(nextUserContent, includeFileDetails)
			includeFileDetails = false // we only need file details the first time

			//  The way this agentic loop works is that cline will be given a task that he then calls tools to complete. unless there's an attempt_completion call, we keep responding back to him with his tool's responses until he either attempt_completion or does not use anymore tools. If he does not use anymore tools, we ask him to consider if he's completed the task and then call attempt_completion, otherwise proceed with completing the task.
			// There is a MAX_REQUESTS_PER_TASK limit to prevent infinite requests, but Cline is prompted to finish the task as efficiently as he can.

			//const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didEndLoop) {
				// For now a task never 'completes'. This will only happen if the user hits max requests and denies resetting the count.
				//this.say("task_completed", `Task completed. Total API usage cost: ${totalCost}`)
				break
			} else {
				// this.say(
				// 	"tool",
				// 	"Cline responded with only text blocks but has not called attempt_completion yet. Forcing him to continue with task..."
				// )
				nextUserContent = [
					{
						type: "text",
						text: formatResponse.noToolsUsed(),
					},
				]
				this.taskState.consecutiveMistakeCount++
			}
		}
	}

	async abortTask() {
		this.taskState.abort = true // will stop any autonomously running promises
		this.terminalManager.disposeAll()
		this.urlContentFetcher.closeBrowser()
		await this.browserSession.dispose()
		this.clineIgnoreController.dispose()
		this.fileContextTracker.dispose()
		await this.diffViewProvider.revertChanges() // need to await for when we want to make sure directories/files are reverted before re-starting the task from a checkpoint

		// Clear the notification callback when task is aborted
		this.mcpHub.clearNotificationCallback()
	}

	// Checkpoints

	async saveCheckpoint(isAttemptCompletionMessage: boolean = false) {
		if (!this.enableCheckpoints) {
			// If checkpoints are disabled, do nothing.
			return
		}
		// Set isCheckpointCheckedOut to false for all checkpoint_created messages
		this.messageStateHandler.getClineMessages().forEach((message) => {
			if (message.say === "checkpoint_created") {
				message.isCheckpointCheckedOut = false
			}
		})

		if (!isAttemptCompletionMessage) {
			// ensure we aren't creating a duplicate checkpoint
			const lastMessage = this.messageStateHandler.getClineMessages().at(-1)
			if (lastMessage?.say === "checkpoint_created") {
				return
			}

			// Initialize checkpoint tracker if it doesn't exist
			if (!this.checkpointTracker && !this.taskState.checkpointTrackerErrorMessage) {
				try {
					this.checkpointTracker = await CheckpointTracker.create(
						this.taskId,
						this.context.globalStorageUri.fsPath,
						this.enableCheckpoints,
					)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					console.error("Failed to initialize checkpoint tracker:", errorMessage)
					this.taskState.checkpointTrackerErrorMessage = errorMessage
					await this.postStateToWebview()
					return
				}
			}

			// Create a checkpoint commit and update clineMessages with a commitHash
			if (this.checkpointTracker) {
				const commitHash = await this.checkpointTracker.commit()
				if (commitHash) {
					await this.say("checkpoint_created")
					const lastCheckpointMessageIndex = findLastIndex(
						this.messageStateHandler.getClineMessages(),
						(m) => m.say === "checkpoint_created",
					)
					if (lastCheckpointMessageIndex !== -1) {
						await this.messageStateHandler.updateClineMessage(lastCheckpointMessageIndex, {
							lastCheckpointHash: commitHash,
						})
					}
				}
			} // silently fails for now

			//
		} else {
			// attempt completion requires checkpoint to be sync so that we can present button after attempt_completion
			// Check if checkpoint tracker exists, if not, create it
			if (!this.checkpointTracker) {
				try {
					this.checkpointTracker = await CheckpointTracker.create(
						this.taskId,
						this.context.globalStorageUri.fsPath,
						this.enableCheckpoints,
					)
					this.messageStateHandler.setCheckpointTracker(this.checkpointTracker)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					console.error("Failed to initialize checkpoint tracker for attempt completion:", errorMessage)
					return
				}
			}

			if (this.checkpointTracker) {
				const commitHash = await this.checkpointTracker.commit()

				// For attempt_completion, find the last completion_result message and set its checkpoint hash. This will be used to present the 'see new changes' button
				const lastCompletionResultMessage = findLast(
					this.messageStateHandler.getClineMessages(),
					(m) => m.say === "completion_result" || m.ask === "completion_result",
				)
				if (lastCompletionResultMessage) {
					lastCompletionResultMessage.lastCheckpointHash = commitHash
					await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
				}
			} else {
				console.error("Checkpoint tracker does not exist and could not be initialized for attempt completion")
			}
		}

		// if (commitHash) {

		// Previously we checkpointed every message, but this is excessive and unnecessary.
		// // Start from the end and work backwards until we find a tool use or another message with a hash
		// for (let i = this.clineMessages.length - 1; i >= 0; i--) {
		// 	const message = this.clineMessages[i]
		// 	if (message.lastCheckpointHash) {
		// 		// Found a message with a hash, so we can stop
		// 		break
		// 	}
		// 	// Update this message with a hash
		// 	message.lastCheckpointHash = commitHash

		// 	// We only care about adding the hash to the last tool use (we don't want to add this hash to every prior message ie for tasks pre-checkpoint)
		// 	const isToolUse =
		// 		message.say === "tool" ||
		// 		message.ask === "tool" ||
		// 		message.say === "command" ||
		// 		message.ask === "command" ||
		// 		message.say === "completion_result" ||
		// 		message.ask === "completion_result" ||
		// 		message.ask === "followup" ||
		// 		message.say === "use_mcp_server" ||
		// 		message.ask === "use_mcp_server" ||
		// 		message.say === "browser_action" ||
		// 		message.say === "browser_action_launch" ||
		// 		message.ask === "browser_action_launch"

		// 	if (isToolUse) {
		// 		break
		// 	}
		// }
		// // Save the updated messages
		// await this.saveClineMessagesAndUpdateHistory()
		// }
	}

	// Tools

	/**
	 * Executes a command directly in Node.js using execa
	 * This is used in test mode to capture the full output without using the VS Code terminal
	 * Commands are automatically terminated after 30 seconds using Promise.race
	 */
	private async executeCommandInNode(command: string): Promise<[boolean, ToolResponse]> {
		try {
			// Create a child process
			const childProcess = execa(command, {
				shell: true,
				cwd: this.cwd,
				reject: false,
				all: true, // Merge stdout and stderr
			})

			// Set up variables to collect output
			let output = ""

			// Collect output in real-time
			if (childProcess.all) {
				childProcess.all.on("data", (data) => {
					output += data.toString()
				})
			}

			// Create a timeout promise that rejects after 30 seconds
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					if (childProcess.pid) {
						childProcess.kill("SIGKILL") // Use SIGKILL for more forceful termination
					}
					reject(new Error("Command timeout after 30s"))
				}, 30000)
			})

			// Race between command completion and timeout
			const result = await Promise.race([childProcess, timeoutPromise]).catch((error) => {
				// If we get here due to timeout, return a partial result with timeout flag
				Logger.info(`Command timed out after 30s: ${command}`)
				return {
					stdout: "",
					stderr: "",
					exitCode: 124, // Standard timeout exit code
					timedOut: true,
				}
			})

			// Check if timeout occurred
			const wasTerminated = result.timedOut === true

			// Use collected output or result output
			if (!output) {
				output = result.stdout || result.stderr || ""
			}

			Logger.info(`Command executed in Node: ${command}\nOutput:\n${output}`)

			// Add termination message if the command was terminated
			if (wasTerminated) {
				output += "\nCommand was taking a while to run so it was auto terminated after 30s"
			}

			// Format the result similar to terminal output
			return [
				false,
				`Command executed${wasTerminated ? " (terminated after 30s)" : ""} with exit code ${
					result.exitCode
				}.${output.length > 0 ? `\nOutput:\n${output}` : ""}`,
			]
		} catch (error) {
			// Handle any errors that might occur
			const errorMessage = error instanceof Error ? error.message : String(error)
			return [false, `Error executing command: ${errorMessage}`]
		}
	}

	async executeCommandTool(command: string): Promise<[boolean, ToolResponse]> {
		Logger.info("IS_TEST: " + isInTestMode())

		// Check if we're in test mode
		if (isInTestMode()) {
			// In test mode, execute the command directly in Node
			Logger.info("Executing command in Node: " + command)
			return this.executeCommandInNode(command)
		}
		Logger.info("Executing command in VS code terminal: " + command)

		const terminalInfo = await this.terminalManager.getOrCreateTerminal(this.cwd)
		terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
		const process = this.terminalManager.runCommand(terminalInfo, command)

		let userFeedback: { text?: string; images?: string[]; files?: string[] } | undefined
		let didContinue = false

		// Chunked terminal output buffering
		const CHUNK_LINE_COUNT = 20
		const CHUNK_BYTE_SIZE = 2048 // 2KB
		const CHUNK_DEBOUNCE_MS = 100

		let outputBuffer: string[] = []
		let outputBufferSize: number = 0
		let chunkTimer: NodeJS.Timeout | null = null
		let chunkEnroute = false

		const flushBuffer = async (force = false) => {
			if (chunkEnroute || outputBuffer.length === 0) {
				if (force && !chunkEnroute && outputBuffer.length > 0) {
					// If force is true and no chunkEnroute, flush anyway
				} else {
					return
				}
			}
			const chunk = outputBuffer.join("\n")
			outputBuffer = []
			outputBufferSize = 0
			chunkEnroute = true
			try {
				const { response, text, images, files } = await this.ask("command_output", chunk)
				if (response === "yesButtonClicked") {
					// proceed while running - but still capture user feedback if provided
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						userFeedback = { text, images, files }
					}
				} else {
					userFeedback = { text, images, files }
				}
				didContinue = true
				process.continue()
			} catch {
				Logger.error("Error while asking for command output")
			} finally {
				chunkEnroute = false
				// If more output accumulated while chunkEnroute, flush again
				if (outputBuffer.length > 0) {
					await flushBuffer()
				}
			}
		}

		const scheduleFlush = () => {
			if (chunkTimer) {
				clearTimeout(chunkTimer)
			}
			chunkTimer = setTimeout(async () => await flushBuffer(), CHUNK_DEBOUNCE_MS)
		}

		const outputLines: string[] = []
		process.on("line", async (line) => {
			outputLines.push(line)

			if (!didContinue) {
				outputBuffer.push(line)
				outputBufferSize += Buffer.byteLength(line, "utf8")
				// Flush if buffer is large enough
				if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
					await flushBuffer()
				} else {
					scheduleFlush()
				}
			} else {
				this.say("command_output", line)
			}
		})

		let completed = false
		process.once("completed", async () => {
			completed = true
			// Flush any remaining buffered output
			if (!didContinue && outputBuffer.length > 0) {
				if (chunkTimer) {
					clearTimeout(chunkTimer)
					chunkTimer = null
				}
				await flushBuffer(true)
			}
		})

		process.once("no_shell_integration", async () => {
			await this.say("shell_integration_warning")
		})

		await process

		// Wait for a short delay to ensure all messages are sent to the webview
		// This delay allows time for non-awaited promises to be created and
		// for their associated messages to be sent to the webview, maintaining
		// the correct order of messages (although the webview is smart about
		// grouping command_output messages despite any gaps anyways)
		await setTimeoutPromise(50)

		let result = this.terminalManager.processOutput(outputLines)

		if (userFeedback) {
			await this.say("user_feedback", userFeedback.text, userFeedback.images, userFeedback.files)
			await this.saveCheckpoint()

			let fileContentString = ""
			if (userFeedback.files && userFeedback.files.length > 0) {
				fileContentString = await processFilesIntoText(userFeedback.files)
			}

			return [
				true,
				formatResponse.toolResult(
					`Command is still running in the user's terminal.${
						result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
					}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
					userFeedback.images,
					fileContentString,
				),
			]
		}

		if (completed) {
			return [false, `Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}`]
		} else {
			return [
				false,
				`Command is still running in the user's terminal.${
					result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
				}\n\nYou will be updated on the terminal status and new output in the future.`,
			]
		}
	}

	/**
	 * Migrates the disableBrowserTool setting from VSCode configuration to browserSettings
	 */
	private async migrateDisableBrowserToolSetting(): Promise<void> {
		const config = vscode.workspace.getConfiguration("cline")
		const disableBrowserTool = config.get<boolean>("disableBrowserTool")

		if (disableBrowserTool !== undefined) {
			this.browserSettings.disableToolUse = disableBrowserTool
			// Remove from VSCode configuration
			await config.update("disableBrowserTool", undefined, true)
		}
	}

	private async migratePreferredLanguageToolSetting(): Promise<void> {
		const config = vscode.workspace.getConfiguration("cline")
		const preferredLanguage = config.get<LanguageDisplay>("preferredLanguage")
		if (preferredLanguage !== undefined) {
			this.chatSettings.preferredLanguage = preferredLanguage
			// Remove from VSCode configuration
			await config.update("preferredLanguage", undefined, true)
		}
	}

	async *attemptApiRequest(previousApiReqIndex: number): ApiStream {
		// Wait for MCP servers to be connected before generating system prompt
		await pWaitFor(() => this.mcpHub.isConnecting !== true, { timeout: 10_000 }).catch(() => {
			console.error("MCP servers failed to connect in time")
		})

		await this.migrateDisableBrowserToolSetting()
		const disableBrowserTool = this.browserSettings.disableToolUse ?? false
		// cline browser tool uses image recognition for navigation (requires model image support).
		const modelSupportsBrowserUse = this.api.getModel().info.supportsImages ?? false

		const supportsBrowserUse = modelSupportsBrowserUse && !disableBrowserTool // only enable browser use if the model supports it and the user hasn't disabled it

		const isNextGenModel = isClaude4ModelFamily(this.api) || isGemini2dot5ModelFamily(this.api)
		let systemPrompt = await SYSTEM_PROMPT(this.cwd, supportsBrowserUse, this.mcpHub, this.browserSettings, isNextGenModel)

		await this.migratePreferredLanguageToolSetting()
		const preferredLanguage = getLanguageKey(this.chatSettings.preferredLanguage as LanguageDisplay)
		const preferredLanguageInstructions =
			preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS
				? `# Preferred Language\n\nSpeak in ${preferredLanguage}.`
				: ""

		const { globalToggles, localToggles } = await refreshClineRulesToggles(this.getContext(), this.cwd)
		const { windsurfLocalToggles, cursorLocalToggles } = await refreshExternalRulesToggles(this.getContext(), this.cwd)

		const globalClineRulesFilePath = await ensureRulesDirectoryExists()
		const globalClineRulesFileInstructions = await getGlobalClineRules(globalClineRulesFilePath, globalToggles)

		const localClineRulesFileInstructions = await getLocalClineRules(this.cwd, localToggles)
		const [localCursorRulesFileInstructions, localCursorRulesDirInstructions] = await getLocalCursorRules(
			this.cwd,
			cursorLocalToggles,
		)
		const localWindsurfRulesFileInstructions = await getLocalWindsurfRules(this.cwd, windsurfLocalToggles)

		const clineIgnoreContent = this.clineIgnoreController.clineIgnoreContent
		let clineIgnoreInstructions: string | undefined
		if (clineIgnoreContent) {
			clineIgnoreInstructions = formatResponse.clineIgnoreInstructions(clineIgnoreContent)
		}

		if (
			globalClineRulesFileInstructions ||
			localClineRulesFileInstructions ||
			localCursorRulesFileInstructions ||
			localCursorRulesDirInstructions ||
			localWindsurfRulesFileInstructions ||
			clineIgnoreInstructions ||
			preferredLanguageInstructions
		) {
			// altering the system prompt mid-task will break the prompt cache, but in the grand scheme this will not change often so it's better to not pollute user messages with it the way we have to with <potentially relevant details>
			const userInstructions = addUserInstructions(
				globalClineRulesFileInstructions,
				localClineRulesFileInstructions,
				localCursorRulesFileInstructions,
				localCursorRulesDirInstructions,
				localWindsurfRulesFileInstructions,
				clineIgnoreInstructions,
				preferredLanguageInstructions,
			)
			systemPrompt += userInstructions
		}
		const contextManagementMetadata = await this.contextManager.getNewContextMessagesAndMetadata(
			this.messageStateHandler.getApiConversationHistory(),
			this.messageStateHandler.getClineMessages(),
			this.api,
			this.taskState.conversationHistoryDeletedRange,
			previousApiReqIndex,
			await ensureTaskDirectoryExists(this.getContext(), this.taskId),
		)

		if (contextManagementMetadata.updatedConversationHistoryDeletedRange) {
			this.taskState.conversationHistoryDeletedRange = contextManagementMetadata.conversationHistoryDeletedRange
			await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
			// saves task history item which we use to keep track of conversation history deleted range
		}

		let stream = this.api.createMessage(systemPrompt, contextManagementMetadata.truncatedConversationHistory)

		const iterator = stream[Symbol.asyncIterator]()

		try {
			// awaiting first chunk to see if it will throw an error
			this.taskState.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			yield firstChunk.value
			this.taskState.isWaitingForFirstChunk = false
		} catch (error) {
			const isOpenRouter = this.api instanceof OpenRouterHandler || this.api instanceof ClineHandler
			const isAnthropic = this.api instanceof AnthropicHandler
			const isOpenRouterContextWindowError = checkIsOpenRouterContextWindowError(error) && isOpenRouter
			const isAnthropicContextWindowError = checkIsAnthropicContextWindowError(error) && isAnthropic

			if (isAnthropic && isAnthropicContextWindowError && !this.taskState.didAutomaticallyRetryFailedApiRequest) {
				this.taskState.conversationHistoryDeletedRange = this.contextManager.getNextTruncationRange(
					this.messageStateHandler.getApiConversationHistory(),
					this.taskState.conversationHistoryDeletedRange,
					"quarter", // Force aggressive truncation
				)
				await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
				await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
					Date.now(),
					await ensureTaskDirectoryExists(this.getContext(), this.taskId),
				)

				this.taskState.didAutomaticallyRetryFailedApiRequest = true
			} else if (isOpenRouter && !this.taskState.didAutomaticallyRetryFailedApiRequest) {
				if (isOpenRouterContextWindowError) {
					this.taskState.conversationHistoryDeletedRange = this.contextManager.getNextTruncationRange(
						this.messageStateHandler.getApiConversationHistory(),
						this.taskState.conversationHistoryDeletedRange,
						"quarter", // Force aggressive truncation
					)
					await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
					await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
						Date.now(),
						await ensureTaskDirectoryExists(this.getContext(), this.taskId),
					)
				}

				console.log("first chunk failed, waiting 1 second before retrying")
				await setTimeoutPromise(1000)
				this.taskState.didAutomaticallyRetryFailedApiRequest = true
			} else {
				// request failed after retrying automatically once, ask user if they want to retry again
				// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.

				if (isOpenRouterContextWindowError || isAnthropicContextWindowError) {
					const truncatedConversationHistory = this.contextManager.getTruncatedMessages(
						this.messageStateHandler.getApiConversationHistory(),
						this.taskState.conversationHistoryDeletedRange,
					)

					// If the conversation has more than 3 messages, we can truncate again. If not, then the conversation is bricked.
					// ToDo: Allow the user to change their input if this is the case.
					if (truncatedConversationHistory.length > 3) {
						error = new Error("Context window exceeded. Click retry to truncate the conversation and try again.")
						this.taskState.didAutomaticallyRetryFailedApiRequest = false
					}
				}

				const errorMessage = formatErrorWithStatusCode(error)

				// Update the 'api_req_started' message to reflect final failure before asking user to manually retry
				const lastApiReqStartedIndex = findLastIndex(
					this.messageStateHandler.getClineMessages(),
					(m) => m.say === "api_req_started",
				)
				if (lastApiReqStartedIndex !== -1) {
					const clineMessages = this.messageStateHandler.getClineMessages()
					const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[lastApiReqStartedIndex].text || "{}")
					delete currentApiReqInfo.retryStatus

					await this.messageStateHandler.updateClineMessage(lastApiReqStartedIndex, {
						text: JSON.stringify({
							...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
							cancelReason: "retries_exhausted", // Indicate that automatic retries failed
							streamingFailedMessage: errorMessage,
						} satisfies ClineApiReqInfo),
					})
					// this.ask will trigger postStateToWebview, so this change should be picked up.
				}

				const { response } = await this.ask("api_req_failed", errorMessage)

				if (response !== "yesButtonClicked") {
					// this will never happen since if noButtonClicked, we will clear current task, aborting this instance
					throw new Error("API request failed")
				}

				await this.say("api_req_retried")
			}
			// delegate generator output from the recursive call
			yield* this.attemptApiRequest(previousApiReqIndex)
			return
		}

		// no error, so we can continue to yield all remaining chunks
		// (needs to be placed outside of try/catch since it we want caller to handle errors not with api_req_failed as that is reserved for first chunk failures only)
		// this delegates to another generator or iterable object. In this case, it's saying "yield all remaining values from this iterator". This effectively passes along all subsequent chunks from the original stream.
		yield* iterator
	}

	async presentAssistantMessage() {
		if (this.taskState.abort) {
			throw new Error("Cline instance aborted")
		}

		if (this.taskState.presentAssistantMessageLocked) {
			this.taskState.presentAssistantMessageHasPendingUpdates = true
			return
		}
		this.taskState.presentAssistantMessageLocked = true
		this.taskState.presentAssistantMessageHasPendingUpdates = false

		if (this.taskState.currentStreamingContentIndex >= this.taskState.assistantMessageContent.length) {
			// this may happen if the last content block was completed before streaming could finish. if streaming is finished, and we're out of bounds then this means we already presented/executed the last content block and are ready to continue to next request
			if (this.taskState.didCompleteReadingStream) {
				this.taskState.userMessageContentReady = true
			}
			this.taskState.presentAssistantMessageLocked = false
			return
			//throw new Error("No more content blocks to stream! This shouldn't happen...") // remove and just return after testing
		}

		const block = cloneDeep(this.taskState.assistantMessageContent[this.taskState.currentStreamingContentIndex]) // need to create copy bc while stream is updating the array, it could be updating the reference block properties too
		switch (block.type) {
			case "text": {
				if (this.taskState.didRejectTool || this.taskState.didAlreadyUseTool) {
					break
				}
				let content = block.content
				if (content) {
					// (have to do this for partial and complete since sending content in thinking tags to markdown renderer will automatically be removed)
					// Remove end substrings of <thinking or </thinking (below xml parsing is only for opening tags)
					// (this is done with the xml parsing below now, but keeping here for reference)
					// content = content.replace(/<\/?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?$/, "")
					// Remove all instances of <thinking> (with optional line break after) and </thinking> (with optional line break before)
					// - Needs to be separate since we dont want to remove the line break before the first tag
					// - Needs to happen before the xml parsing below
					content = content.replace(/<thinking>\s?/g, "")
					content = content.replace(/\s?<\/thinking>/g, "")

					// Remove partial XML tag at the very end of the content (for tool use and thinking tags)
					// (prevents scrollview from jumping when tags are automatically removed)
					const lastOpenBracketIndex = content.lastIndexOf("<")
					if (lastOpenBracketIndex !== -1) {
						const possibleTag = content.slice(lastOpenBracketIndex)
						// Check if there's a '>' after the last '<' (i.e., if the tag is complete) (complete thinking and tool tags will have been removed by now)
						const hasCloseBracket = possibleTag.includes(">")
						if (!hasCloseBracket) {
							// Extract the potential tag name
							let tagContent: string
							if (possibleTag.startsWith("</")) {
								tagContent = possibleTag.slice(2).trim()
							} else {
								tagContent = possibleTag.slice(1).trim()
							}
							// Check if tagContent is likely an incomplete tag name (letters and underscores only)
							const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)
							// Preemptively remove < or </ to keep from these artifacts showing up in chat (also handles closing thinking tags)
							const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"
							// If the tag is incomplete and at the end, remove it from the content
							if (isOpeningOrClosing || isLikelyTagName) {
								content = content.slice(0, lastOpenBracketIndex).trim()
							}
						}
					}
				}

				if (!block.partial) {
					// Some models add code block artifacts (around the tool calls) which show up at the end of text content
					// matches ``` with at least one char after the last backtick, at the end of the string
					const match = content?.trimEnd().match(/```[a-zA-Z0-9_-]+$/)
					if (match) {
						const matchLength = match[0].length
						content = content.trimEnd().slice(0, -matchLength)
					}
				}

				await this.say("text", content, undefined, undefined, block.partial)
				break
			}
			case "tool_use":
				await this.toolExecutor.executeTool(block)
				break
		}

		/*
		Seeing out of bounds is fine, it means that the next too call is being built up and ready to add to assistantMessageContent to present. 
		When you see the UI inactive during this, it means that a tool is breaking without presenting any UI. For example the write_to_file tool was breaking when relpath was undefined, and for invalid relpath it never presented UI.
		*/
		this.taskState.presentAssistantMessageLocked = false // this needs to be placed here, if not then calling this.presentAssistantMessage below would fail (sometimes) since it's locked
		// NOTE: when tool is rejected, iterator stream is interrupted and it waits for userMessageContentReady to be true. Future calls to present will skip execution since didRejectTool and iterate until contentIndex is set to message length and it sets userMessageContentReady to true itself (instead of preemptively doing it in iterator)
		if (!block.partial || this.taskState.didRejectTool || this.taskState.didAlreadyUseTool) {
			// block is finished streaming and executing
			if (this.taskState.currentStreamingContentIndex === this.taskState.assistantMessageContent.length - 1) {
				// its okay that we increment if !didCompleteReadingStream, it'll just return bc out of bounds and as streaming continues it will call presentAssistantMessage if a new block is ready. if streaming is finished then we set userMessageContentReady to true when out of bounds. This gracefully allows the stream to continue on and all potential content blocks be presented.
				// last block is complete and it is finished executing
				this.taskState.userMessageContentReady = true // will allow pwaitfor to continue
			}

			// call next block if it exists (if not then read stream will call it when its ready)
			this.taskState.currentStreamingContentIndex++ // need to increment regardless, so when read stream calls this function again it will be streaming the next block

			if (this.taskState.currentStreamingContentIndex < this.taskState.assistantMessageContent.length) {
				// there are already more content blocks to stream, so we'll call this function ourselves
				// await this.presentAssistantContent()

				this.presentAssistantMessage()
				return
			}
		}
		// block is partial, but the read stream may have finished
		if (this.taskState.presentAssistantMessageHasPendingUpdates) {
			this.presentAssistantMessage()
		}
	}

	async recursivelyMakeClineRequests(userContent: UserContent, includeFileDetails: boolean = false): Promise<boolean> {
		if (this.taskState.abort) {
			throw new Error("Cline instance aborted")
		}

		// Used to know what models were used in the task if user wants to export metadata for error reporting purposes
		const currentProviderId = (await getGlobalState(this.getContext(), "apiProvider")) as string
		if (currentProviderId && this.api.getModel().id) {
			try {
				await this.modelContextTracker.recordModelUsage(currentProviderId, this.api.getModel().id, this.chatSettings.mode)
			} catch {}
		}

		if (this.taskState.consecutiveMistakeCount >= 3) {
			if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
				showSystemNotification({
					subtitle: "Error",
					message: "Cline is having trouble. Would you like to continue the task?",
				})
			}
			const { response, text, images, files } = await this.ask(
				"mistake_limit_reached",
				this.api.getModel().id.includes("claude")
					? `This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
					: "Cline uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 4 Sonnet for its advanced agentic coding capabilities.",
			)
			if (response === "messageResponse") {
				// This userContent is for the *next* API call.
				const feedbackUserContent: UserContent = []
				feedbackUserContent.push({
					type: "text",
					text: formatResponse.tooManyMistakes(text),
				})
				if (images && images.length > 0) {
					feedbackUserContent.push(...formatResponse.imageBlocks(images))
				}

				let fileContentString = ""
				if (files && files.length > 0) {
					fileContentString = await processFilesIntoText(files)
				}

				if (fileContentString) {
					feedbackUserContent.push({
						type: "text",
						text: fileContentString,
					})
				}

				userContent = feedbackUserContent
			}
			this.taskState.consecutiveMistakeCount = 0
		}

		if (
			this.autoApprovalSettings.enabled &&
			this.taskState.consecutiveAutoApprovedRequestsCount >= this.autoApprovalSettings.maxRequests
		) {
			if (this.autoApprovalSettings.enableNotifications) {
				showSystemNotification({
					subtitle: "Max Requests Reached",
					message: `Cline has auto-approved ${this.autoApprovalSettings.maxRequests.toString()} API requests.`,
				})
			}
			const { response, text, images, files } = await this.ask(
				"auto_approval_max_req_reached",
				`Cline has auto-approved ${this.autoApprovalSettings.maxRequests.toString()} API requests. Would you like to reset the count and proceed with the task?`,
			)
			// if we get past the promise it means the user approved and did not start a new task
			this.taskState.consecutiveAutoApprovedRequestsCount = 0

			// Process user feedback if provided
			if (response === "messageResponse") {
				// Display the user's message in the chat UI
				await this.say("user_feedback", text, images, files)

				// This userContent is for the *next* API call.
				const feedbackUserContent: UserContent = []
				feedbackUserContent.push({
					type: "text",
					text: formatResponse.autoApprovalMaxReached(text),
				})
				if (images && images.length > 0) {
					feedbackUserContent.push(...formatResponse.imageBlocks(images))
				}

				let fileContentString = ""
				if (files && files.length > 0) {
					fileContentString = await processFilesIntoText(files)
				}

				if (fileContentString) {
					feedbackUserContent.push({
						type: "text",
						text: fileContentString,
					})
				}

				userContent = feedbackUserContent
			}
		}

		// get previous api req's index to check token usage and determine if we need to truncate conversation history
		const previousApiReqIndex = findLastIndex(this.messageStateHandler.getClineMessages(), (m) => m.say === "api_req_started")

		// Save checkpoint if this is the first API request
		const isFirstRequest = this.messageStateHandler.getClineMessages().filter((m) => m.say === "api_req_started").length === 0

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		await this.say(
			"api_req_started",
			JSON.stringify({
				request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
			}),
		)

		// Initialize checkpoint tracker first if enabled and it's the first request
		if (
			isFirstRequest &&
			this.enableCheckpoints &&
			!this.checkpointTracker &&
			!this.taskState.checkpointTrackerErrorMessage
		) {
			try {
				this.checkpointTracker = await pTimeout(
					CheckpointTracker.create(this.taskId, this.context.globalStorageUri.fsPath, this.enableCheckpoints),
					{
						milliseconds: 15_000,
						message:
							"Checkpoints taking too long to initialize. Consider re-opening Cline in a project that uses git, or disabling checkpoints.",
					},
				)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				this.taskState.checkpointTrackerErrorMessage = errorMessage // will be displayed right away since we saveClineMessages next which posts state to webview
			}
		}

		// Now, if it's the first request AND checkpoints are enabled AND tracker was successfully initialized,
		// then say "checkpoint_created" and perform the commit.
		if (isFirstRequest && this.enableCheckpoints && this.checkpointTracker) {
			const commitHash = await this.checkpointTracker.commit() // Actual commit
			await this.say("checkpoint_created") // Now this is conditional
			const lastCheckpointMessageIndex = findLastIndex(
				this.messageStateHandler.getClineMessages(),
				(m) => m.say === "checkpoint_created",
			)
			if (lastCheckpointMessageIndex !== -1) {
				await this.messageStateHandler.updateClineMessage(lastCheckpointMessageIndex, {
					lastCheckpointHash: commitHash,
				})
				// saveClineMessagesAndUpdateHistory will be called later after API response,
				// so no need to call it here unless this is the only modification to this message.
				// For now, assuming it's handled later.
			}
		} else if (
			isFirstRequest &&
			this.enableCheckpoints &&
			!this.checkpointTracker &&
			this.taskState.checkpointTrackerErrorMessage
		) {
			// Checkpoints are enabled, but tracker failed to initialize.
			// checkpointTrackerErrorMessage is already set and will be part of the state.
			// No explicit UI message here, error message will be in ExtensionState.
		}

		const [parsedUserContent, environmentDetails, clinerulesError] = await this.loadContext(userContent, includeFileDetails)

		// error handling if the user uses the /newrule command & their .clinerules is a file, for file read operations didnt work properly
		if (clinerulesError === true) {
			await this.say(
				"error",
				"Issue with processing the /newrule command. Double check that, if '.clinerules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory.",
			)
		}

		userContent = parsedUserContent
		// add environment details as its own text block, separate from tool results
		userContent.push({ type: "text", text: environmentDetails })

		await this.messageStateHandler.addToApiConversationHistory({
			role: "user",
			content: userContent,
		})

		telemetryService.captureConversationTurnEvent(this.taskId, currentProviderId, this.api.getModel().id, "user", true)

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = findLastIndex(this.messageStateHandler.getClineMessages(), (m) => m.say === "api_req_started")
		await this.messageStateHandler.updateClineMessage(lastApiReqIndex, {
			text: JSON.stringify({
				request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
			} satisfies ClineApiReqInfo),
		})
		await this.postStateToWebview()

		try {
			let cacheWriteTokens = 0
			let cacheReadTokens = 0
			let inputTokens = 0
			let outputTokens = 0
			let totalCost: number | undefined

			const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				if (this.diffViewProvider.isEditing) {
					await this.diffViewProvider.revertChanges() // closes diff view
				}

				// if last message is a partial we need to update and save it
				const lastMessage = this.messageStateHandler.getClineMessages().at(-1)
				if (lastMessage && lastMessage.partial) {
					// lastMessage.ts = Date.now() DO NOT update ts since it is used as a key for virtuoso list
					lastMessage.partial = false
					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					console.log("updating partial message", lastMessage)
					// await this.saveClineMessagesAndUpdateHistory()
				}

				// Let assistant know their response was interrupted for when task is resumed
				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [
						{
							type: "text",
							text:
								assistantMessage +
								`\n\n[${
									cancelReason === "streaming_failed"
										? "Response interrupted by API Error"
										: "Response interrupted by user"
								}]`,
						},
					],
				})

				// update api_req_started to have cancelled and cost, so that we can display the cost of the partial stream
				await updateApiReqMsg({
					messageStateHandler: this.messageStateHandler,
					lastApiReqIndex,
					inputTokens,
					outputTokens,
					cacheWriteTokens,
					cacheReadTokens,
					totalCost,
					api: this.api,
					cancelReason,
					streamingFailedMessage,
				})
				await this.messageStateHandler.saveClineMessagesAndUpdateHistory()

				telemetryService.captureConversationTurnEvent(
					this.taskId,
					currentProviderId,
					this.api.getModel().id,
					"assistant",
					true,
				)

				// signals to provider that it can retrieve the saved messages from disk, as abortTask can not be awaited on in nature
				this.taskState.didFinishAbortingStream = true
			}

			// reset streaming state
			this.taskState.currentStreamingContentIndex = 0
			this.taskState.assistantMessageContent = []
			this.taskState.didCompleteReadingStream = false
			this.taskState.userMessageContent = []
			this.taskState.userMessageContentReady = false
			this.taskState.didRejectTool = false
			this.taskState.didAlreadyUseTool = false
			this.taskState.presentAssistantMessageLocked = false
			this.taskState.presentAssistantMessageHasPendingUpdates = false
			this.taskState.didAutomaticallyRetryFailedApiRequest = false
			await this.diffViewProvider.reset()

			const stream = this.attemptApiRequest(previousApiReqIndex) // yields only if the first chunk is successful, otherwise will allow the user to retry the request (most likely due to rate limit error, which gets thrown on the first chunk)
			let assistantMessage = ""
			let reasoningMessage = ""
			this.taskState.isStreaming = true
			let didReceiveUsageChunk = false
			try {
				for await (const chunk of stream) {
					if (!chunk) {
						continue
					}
					switch (chunk.type) {
						case "usage":
							didReceiveUsageChunk = true
							inputTokens += chunk.inputTokens
							outputTokens += chunk.outputTokens
							cacheWriteTokens += chunk.cacheWriteTokens ?? 0
							cacheReadTokens += chunk.cacheReadTokens ?? 0
							totalCost = chunk.totalCost
							break
						case "reasoning":
							// reasoning will always come before assistant message
							reasoningMessage += chunk.reasoning
							// fixes bug where cancelling task > aborts task > for loop may be in middle of streaming reasoning > say function throws error before we get a chance to properly clean up and cancel the task.
							if (!this.taskState.abort) {
								await this.say("reasoning", reasoningMessage, undefined, undefined, true)
							}
							break
						case "text":
							if (reasoningMessage && assistantMessage.length === 0) {
								// complete reasoning message
								await this.say("reasoning", reasoningMessage, undefined, undefined, false)
							}
							assistantMessage += chunk.text
							// parse raw assistant message into content blocks
							const prevLength = this.taskState.assistantMessageContent.length
							const isNextGenModel = isClaude4ModelFamily(this.api) || isGemini2dot5ModelFamily(this.api)
							if (isNextGenModel && USE_EXPERIMENTAL_CLAUDE4_FEATURES) {
								this.taskState.assistantMessageContent = parseAssistantMessageV3(assistantMessage)
							} else {
								this.taskState.assistantMessageContent = parseAssistantMessageV2(assistantMessage)
							}

							if (this.taskState.assistantMessageContent.length > prevLength) {
								this.taskState.userMessageContentReady = false // new content we need to present, reset to false in case previous content set this to true
							}
							// present content to user
							this.presentAssistantMessage()
							break
					}

					if (this.taskState.abort) {
						console.log("aborting stream...")
						if (!this.taskState.abandoned) {
							// only need to gracefully abort if this instance isn't abandoned (sometimes openrouter stream hangs, in which case this would affect future instances of cline)
							await abortStream("user_cancelled")
						}
						break // aborts the stream
					}

					if (this.taskState.didRejectTool) {
						// userContent has a tool rejection, so interrupt the assistant's response to present the user's feedback
						assistantMessage += "\n\n[Response interrupted by user feedback]"
						// this.userMessageContentReady = true // instead of setting this preemptively, we allow the present iterator to finish and set userMessageContentReady when its ready
						break
					}

					// PREV: we need to let the request finish for openrouter to get generation details
					// UPDATE: it's better UX to interrupt the request at the cost of the api cost not being retrieved
					if (this.taskState.didAlreadyUseTool) {
						assistantMessage +=
							"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
						break
					}
				}
			} catch (error) {
				// abandoned happens when extension is no longer waiting for the cline instance to finish aborting (error is thrown here when any function in the for loop throws due to this.abort)
				if (!this.taskState.abandoned) {
					this.abortTask() // if the stream failed, there's various states the task could be in (i.e. could have streamed some tools the user may have executed), so we just resort to replicating a cancel task
					const errorMessage = formatErrorWithStatusCode(error)

					await abortStream("streaming_failed", errorMessage)
					await this.reinitExistingTaskFromId(this.taskId)
				}
			} finally {
				this.taskState.isStreaming = false
			}

			// OpenRouter/Cline may not return token usage as part of the stream (since it may abort early), so we fetch after the stream is finished
			// (updateApiReq below will update the api_req_started message with the usage details. we do this async so it updates the api_req_started message in the background)
			if (!didReceiveUsageChunk) {
				this.api.getApiStreamUsage?.().then(async (apiStreamUsage) => {
					if (apiStreamUsage) {
						inputTokens += apiStreamUsage.inputTokens
						outputTokens += apiStreamUsage.outputTokens
						cacheWriteTokens += apiStreamUsage.cacheWriteTokens ?? 0
						cacheReadTokens += apiStreamUsage.cacheReadTokens ?? 0
						totalCost = apiStreamUsage.totalCost
					}
					await updateApiReqMsg({
						messageStateHandler: this.messageStateHandler,
						lastApiReqIndex,
						inputTokens,
						outputTokens,
						cacheWriteTokens,
						cacheReadTokens,
						api: this.api,
						totalCost,
					})
					await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
					await this.postStateToWebview()
				})
			}

			// need to call here in case the stream was aborted
			if (this.taskState.abort) {
				throw new Error("Cline instance aborted")
			}

			this.taskState.didCompleteReadingStream = true

			// set any blocks to be complete to allow presentAssistantMessage to finish and set userMessageContentReady to true
			// (could be a text block that had no subsequent tool uses, or a text block at the very end, or an invalid tool use, etc. whatever the case, presentAssistantMessage relies on these blocks either to be completed or the user to reject a block in order to proceed and eventually set userMessageContentReady to true)
			const partialBlocks = this.taskState.assistantMessageContent.filter((block) => block.partial)
			partialBlocks.forEach((block) => {
				block.partial = false
			})
			// this.assistantMessageContent.forEach((e) => (e.partial = false)) // can't just do this bc a tool could be in the middle of executing ()
			if (partialBlocks.length > 0) {
				this.presentAssistantMessage() // if there is content to update then it will complete and update this.userMessageContentReady to true, which we pwaitfor before making the next request. all this is really doing is presenting the last partial message that we just set to complete
			}

			await updateApiReqMsg({
				messageStateHandler: this.messageStateHandler,
				lastApiReqIndex,
				inputTokens,
				outputTokens,
				cacheWriteTokens,
				cacheReadTokens,
				api: this.api,
				totalCost,
			})
			await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
			await this.postStateToWebview()

			// now add to apiconversationhistory
			// need to save assistant responses to file before proceeding to tool use since user can exit at any moment and we wouldn't be able to save the assistant's response
			let didEndLoop = false
			if (assistantMessage.length > 0) {
				telemetryService.captureConversationTurnEvent(
					this.taskId,
					currentProviderId,
					this.api.getModel().id,
					"assistant",
					true,
				)

				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [{ type: "text", text: assistantMessage }],
				})

				// NOTE: this comment is here for future reference - this was a workaround for userMessageContent not getting set to true. It was due to it not recursively calling for partial blocks when didRejectTool, so it would get stuck waiting for a partial block to complete before it could continue.
				// in case the content blocks finished
				// it may be the api stream finished after the last parsed content block was executed, so  we are able to detect out of bounds and set userMessageContentReady to true (note you should not call presentAssistantMessage since if the last block is completed it will be presented again)
				// const completeBlocks = this.assistantMessageContent.filter((block) => !block.partial) // if there are any partial blocks after the stream ended we can consider them invalid
				// if (this.currentStreamingContentIndex >= completeBlocks.length) {
				// 	this.userMessageContentReady = true
				// }

				await pWaitFor(() => this.taskState.userMessageContentReady)

				// if the model did not tool use, then we need to tell it to either use a tool or attempt_completion
				const didToolUse = this.taskState.assistantMessageContent.some((block) => block.type === "tool_use")

				if (!didToolUse) {
					// normal request where tool use is required
					this.taskState.userMessageContent.push({
						type: "text",
						text: formatResponse.noToolsUsed(),
					})
					this.taskState.consecutiveMistakeCount++
				}

				const recDidEndLoop = await this.recursivelyMakeClineRequests(this.taskState.userMessageContent)
				didEndLoop = recDidEndLoop
			} else {
				// if there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				await this.say(
					"error",
					"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
				)
				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Failure: I did not provide a response.",
						},
					],
				})
			}

			return didEndLoop // will always be false for now
		} catch (error) {
			// this should never happen since the only thing that can throw an error is the attemptApiRequest, which is wrapped in a try catch that sends an ask where if noButtonClicked, will clear current task and destroy this instance. However to avoid unhandled promise rejection, we will end this loop which will end execution of this instance (see startTask)
			return true // needs to be true so parent loop knows to end task
		}
	}

	async loadContext(userContent: UserContent, includeFileDetails: boolean = false): Promise<[UserContent, string, boolean]> {
		// Track if we need to check clinerulesFile
		let needsClinerulesFileCheck = false

		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(this.getContext(), this.cwd)

		const processUserContent = async () => {
			// This is a temporary solution to dynamically load context mentions from tool results. It checks for the presence of tags that indicate that the tool was rejected and feedback was provided (see formatToolDeniedFeedback, attemptCompletion, executeCommand, and consecutiveMistakeCount >= 3) or "<answer>" (see askFollowupQuestion), we place all user generated content in these tags so they can effectively be used as markers for when we should parse mentions). However if we allow multiple tools responses in the future, we will need to parse mentions specifically within the user content tags.
			// (Note: this caused the @/ import alias bug where file contents were being parsed as well, since v2 converted tool results to text blocks)
			return await Promise.all(
				userContent.map(async (block) => {
					if (block.type === "text") {
						// We need to ensure any user generated content is wrapped in one of these tags so that we know to parse mentions
						// FIXME: Only parse text in between these tags instead of the entire text block which may contain other tool results. This is part of a larger issue where we shouldn't be using regex to parse mentions in the first place (ie for cases where file paths have spaces)
						if (
							block.text.includes("<feedback>") ||
							block.text.includes("<answer>") ||
							block.text.includes("<task>") ||
							block.text.includes("<user_message>")
						) {
							const parsedText = await parseMentions(
								block.text,
								this.cwd,
								this.urlContentFetcher,
								this.fileContextTracker,
							)

							// when parsing slash commands, we still want to allow the user to provide their desired context
							const { processedText, needsClinerulesFileCheck: needsCheck } = await parseSlashCommands(
								parsedText,
								localWorkflowToggles,
								globalWorkflowToggles,
							)

							if (needsCheck) {
								needsClinerulesFileCheck = true
							}

							return {
								...block,
								text: processedText,
							}
						}
					}
					return block
				}),
			)
		}

		// Run initial promises in parallel
		const [processedUserContent, environmentDetails] = await Promise.all([
			processUserContent(),
			this.getEnvironmentDetails(includeFileDetails),
		])

		// After processing content, check clinerulesData if needed
		let clinerulesError = false
		if (needsClinerulesFileCheck) {
			clinerulesError = await ensureLocalClineDirExists(this.cwd, GlobalFileNames.clineRules)
		}

		// Return all results
		return [processedUserContent, environmentDetails, clinerulesError]
	}

	async getEnvironmentDetails(includeFileDetails: boolean = false) {
		let details = ""

		// It could be useful for cline to know if the user went from one or no file to another between messages, so we always include this context
		details += "\n\n# VSCode Visible Files"
		const visibleFilePaths = vscode.window.visibleTextEditors
			?.map((editor) => editor.document?.uri?.fsPath)
			.filter(Boolean)
			.map((absolutePath) => path.relative(this.cwd, absolutePath))

		// Filter paths through clineIgnoreController
		const allowedVisibleFiles = this.clineIgnoreController
			.filterPaths(visibleFilePaths)
			.map((p) => p.toPosix())
			.join("\n")

		if (allowedVisibleFiles) {
			details += `\n${allowedVisibleFiles}`
		} else {
			details += "\n(No visible files)"
		}

		details += "\n\n# VSCode Open Tabs"
		const openTabPaths = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
			.filter(Boolean)
			.map((absolutePath) => path.relative(this.cwd, absolutePath))

		// Filter paths through clineIgnoreController
		const allowedOpenTabs = this.clineIgnoreController
			.filterPaths(openTabPaths)
			.map((p) => p.toPosix())
			.join("\n")

		if (allowedOpenTabs) {
			details += `\n${allowedOpenTabs}`
		} else {
			details += "\n(No open tabs)"
		}

		const busyTerminals = this.terminalManager.getTerminals(true)
		const inactiveTerminals = this.terminalManager.getTerminals(false)
		// const allTerminals = [...busyTerminals, ...inactiveTerminals]

		if (busyTerminals.length > 0 && this.taskState.didEditFile) {
			//  || this.didEditFile
			await setTimeoutPromise(300) // delay after saving file to let terminals catch up
		}

		// let terminalWasBusy = false
		if (busyTerminals.length > 0) {
			// wait for terminals to cool down
			// terminalWasBusy = allTerminals.some((t) => this.terminalManager.isProcessHot(t.id))
			await pWaitFor(() => busyTerminals.every((t) => !this.terminalManager.isProcessHot(t.id)), {
				interval: 100,
				timeout: 15_000,
			}).catch(() => {})
		}

		// we want to get diagnostics AFTER terminal cools down for a few reasons: terminal could be scaffolding a project, dev servers (compilers like webpack) will first re-compile and then send diagnostics, etc
		/*
		let diagnosticsDetails = ""
		const diagnostics = await this.diagnosticsMonitor.getCurrentDiagnostics(this.didEditFile || terminalWasBusy) // if cline ran a command (ie npm install) or edited the workspace then wait a bit for updated diagnostics
		for (const [uri, fileDiagnostics] of diagnostics) {
			const problems = fileDiagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
			if (problems.length > 0) {
				diagnosticsDetails += `\n## ${path.relative(cwd, uri.fsPath)}`
				for (const diagnostic of problems) {
					// let severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? "Error" : "Warning"
					const line = diagnostic.range.start.line + 1 // VSCode lines are 0-indexed
					const source = diagnostic.source ? `[${diagnostic.source}] ` : ""
					diagnosticsDetails += `\n- ${source}Line ${line}: ${diagnostic.message}`
				}
			}
		}
		*/
		this.taskState.didEditFile = false // reset, this lets us know when to wait for saved files to update terminals

		// waiting for updated diagnostics lets terminal output be the most up-to-date possible
		let terminalDetails = ""
		if (busyTerminals.length > 0) {
			// terminals are cool, let's retrieve their output
			terminalDetails += "\n\n# Actively Running Terminals"
			for (const busyTerminal of busyTerminals) {
				terminalDetails += `\n## Original command: \`${busyTerminal.lastCommand}\``
				const newOutput = this.terminalManager.getUnretrievedOutput(busyTerminal.id)
				if (newOutput) {
					terminalDetails += `\n### New Output\n${newOutput}`
				} else {
					// details += `\n(Still running, no new output)` // don't want to show this right after running the command
				}
			}
		}
		// only show inactive terminals if there's output to show
		if (inactiveTerminals.length > 0) {
			const inactiveTerminalOutputs = new Map<number, string>()
			for (const inactiveTerminal of inactiveTerminals) {
				const newOutput = this.terminalManager.getUnretrievedOutput(inactiveTerminal.id)
				if (newOutput) {
					inactiveTerminalOutputs.set(inactiveTerminal.id, newOutput)
				}
			}
			if (inactiveTerminalOutputs.size > 0) {
				terminalDetails += "\n\n# Inactive Terminals"
				for (const [terminalId, newOutput] of inactiveTerminalOutputs) {
					const inactiveTerminal = inactiveTerminals.find((t) => t.id === terminalId)
					if (inactiveTerminal) {
						terminalDetails += `\n## ${inactiveTerminal.lastCommand}`
						terminalDetails += `\n### New Output\n${newOutput}`
					}
				}
			}
		}

		// details += "\n\n# VSCode Workspace Errors"
		// if (diagnosticsDetails) {
		// 	details += diagnosticsDetails
		// } else {
		// 	details += "\n(No errors detected)"
		// }

		if (terminalDetails) {
			details += terminalDetails
		}

		// Add recently modified files section
		const recentlyModifiedFiles = this.fileContextTracker.getAndClearRecentlyModifiedFiles()
		if (recentlyModifiedFiles.length > 0) {
			details +=
				"\n\n# Recently Modified Files\nThese files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):"
			for (const filePath of recentlyModifiedFiles) {
				details += `\n${filePath}`
			}
		}

		// Add current time information with timezone
		const now = new Date()
		const formatter = new Intl.DateTimeFormat(undefined, {
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			hour12: true,
		})
		const timeZone = formatter.resolvedOptions().timeZone
		const timeZoneOffset = -now.getTimezoneOffset() / 60 // Convert to hours and invert sign to match conventional notation
		const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : ""}${timeZoneOffset}:00`
		details += `\n\n# Current Time\n${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})`

		if (includeFileDetails) {
			details += `\n\n# Current Working Directory (${this.cwd.toPosix()}) Files\n`
			const isDesktop = arePathsEqual(this.cwd, getDesktopDir())
			if (isDesktop) {
				// don't want to immediately access desktop since it would show permission popup
				details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
			} else {
				const [files, didHitLimit] = await listFiles(this.cwd, true, 200)
				const result = formatResponse.formatFilesList(this.cwd, files, didHitLimit, this.clineIgnoreController)
				details += result
			}

			// Add git remote URLs section
			const gitRemotes = await getGitRemoteUrls(this.cwd)
			if (gitRemotes.length > 0) {
				details += `\n\n# Git Remote URLs\n${gitRemotes.join("\n")}`
			}
		}

		// Add context window usage information
		const { contextWindow, maxAllowedSize } = getContextWindowInfo(this.api)

		// Get the token count from the most recent API request to accurately reflect context management
		const getTotalTokensFromApiReqMessage = (msg: ClineMessage) => {
			if (!msg.text) {
				return 0
			}
			try {
				const { tokensIn, tokensOut, cacheWrites, cacheReads } = JSON.parse(msg.text)
				return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
			} catch (e) {
				return 0
			}
		}

		const clineMessages = this.messageStateHandler.getClineMessages()
		const modifiedMessages = combineApiRequests(combineCommandSequences(clineMessages.slice(1)))
		const lastApiReqMessage = findLast(modifiedMessages, (msg) => {
			if (msg.say !== "api_req_started") {
				return false
			}
			return getTotalTokensFromApiReqMessage(msg) > 0
		})

		const lastApiReqTotalTokens = lastApiReqMessage ? getTotalTokensFromApiReqMessage(lastApiReqMessage) : 0
		const usagePercentage = Math.round((lastApiReqTotalTokens / contextWindow) * 100)

		details += "\n\n# Context Window Usage"
		details += `\n${lastApiReqTotalTokens.toLocaleString()} / ${(contextWindow / 1000).toLocaleString()}K tokens used (${usagePercentage}%)`

		details += "\n\n# Current Mode"
		if (this.chatSettings.mode === "plan") {
			details += "\nPLAN MODE\n" + formatResponse.planModeInstructions()
		} else {
			details += "\nACT MODE"
		}

		return `<environment_details>\n${details.trim()}\n</environment_details>`
	}
}
