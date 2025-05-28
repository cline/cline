import { Anthropic } from "@anthropic-ai/sdk"
import cloneDeep from "clone-deep"
import { execa } from "execa"
import getFolderSize from "get-folder-size"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import os from "os"
import pTimeout from "p-timeout"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { Logger } from "@services/logging/Logger"
import { ApiHandler, buildApiHandler } from "@api/index"
import { AnthropicHandler } from "@api/providers/anthropic"
import { ClineHandler } from "@api/providers/cline"
import { OpenRouterHandler } from "@api/providers/openrouter"
import { ApiStream } from "@api/transform/stream"
import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { formatContentBlockToMarkdown } from "@integrations/misc/export-markdown"
import { extractTextFromFile } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { TerminalManager } from "@integrations/terminal/TerminalManager"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { listFiles } from "@services/glob/list-files"
import { regexSearchFiles } from "@services/ripgrep"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { parseSourceCodeForDefinitionsTopLevel } from "@services/tree-sitter"
import { ApiConfiguration } from "@shared/api"
import { findLast, findLastIndex, parsePartialArrayString } from "@shared/array"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { BrowserSettings } from "@shared/BrowserSettings"
import { ChatSettings } from "@shared/ChatSettings"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import {
	BrowserAction,
	BrowserActionResult,
	browserActions,
	ClineApiReqCancelReason,
	ClineApiReqInfo,
	ClineAsk,
	ClineAskQuestion,
	ClineAskUseMcpServer,
	ClineMessage,
	ClinePlanModeResponse,
	ClineSay,
	ClineSayBrowserAction,
	ClineSayTool,
	COMPLETION_RESULT_CHANGES_FLAG,
	ExtensionMessage,
} from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, LanguageDisplay } from "@shared/Languages"
import { ClineAskResponse, ClineCheckpointRestore } from "@shared/WebviewMessage"
import { calculateApiCostAnthropic } from "@utils/cost"
import { fileExistsAtPath } from "@utils/fs"
import { createAndOpenGitHubIssue } from "@utils/github-url-utils"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"
import { AssistantMessageContent, parseAssistantMessageV2, ToolParamName, ToolUseName } from "@core/assistant-message"
import { constructNewFileContent } from "@core/assistant-message/diff"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { parseMentions } from "@core/mentions"
import { formatResponse } from "@core/prompts/responses"
import { addUserInstructions, SYSTEM_PROMPT } from "@core/prompts/system"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ModelContextTracker } from "@core/context/context-tracking/ModelContextTracker"
import {
	checkIsAnthropicContextWindowError,
	checkIsOpenRouterContextWindowError,
} from "@core/context/context-management/context-error-handling"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { loadMcpDocumentation } from "@core/prompts/loadMcpDocumentation"
import {
	ensureRulesDirectoryExists,
	ensureTaskDirectoryExists,
	getSavedApiConversationHistory,
	getSavedClineMessages,
	GlobalFileNames,
	saveApiConversationHistory,
	saveClineMessages,
} from "@core/storage/disk"
import {
	getGlobalClineRules,
	getLocalClineRules,
	refreshClineRulesToggles,
} from "@core/context/instructions/user-instructions/cline-rules"
import { ensureLocalClineDirExists } from "../context/instructions/user-instructions/rule-helpers"
import {
	refreshExternalRulesToggles,
	getLocalWindsurfRules,
	getLocalCursorRules,
} from "@core/context/instructions/user-instructions/external-rules"
import { refreshWorkflowToggles } from "../context/instructions/user-instructions/workflows"
import { getGlobalState } from "@core/storage/state"
import { parseSlashCommands } from "@core/slash-commands"
import WorkspaceTracker from "@integrations/workspace/WorkspaceTracker"
import { McpHub } from "@services/mcp/McpHub"
import { isInTestMode } from "../../services/test/TestMode"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { featureFlagsService } from "@services/posthog/feature-flags/FeatureFlagsService"
import { StreamingJsonReplacer, ChangeLocation } from "@core/assistant-message/diff-json"
import { parseAssistantMessageV3 } from "../assistant-message/parse-assistant-message"

export const cwd =
	vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop") // may or may not exist but fs checking existence would immediately ask for permission which would be bad UX, need to come up with a better solution

type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>
type UserContent = Array<Anthropic.ContentBlockParam>

export class Task {
	private streamingJsonReplacer?: StreamingJsonReplacer
	private lastProcessedJsonLength: number = 0

	// dependencies
	private context: vscode.ExtensionContext
	private mcpHub: McpHub
	private workspaceTracker: WorkspaceTracker
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private postStateToWebview: () => Promise<void>
	private postMessageToWebview: (message: ExtensionMessage) => Promise<void>
	private reinitExistingTaskFromId: (taskId: string) => Promise<void>
	private cancelTask: () => Promise<void>

	readonly taskId: string
	private taskIsFavorited?: boolean
	api: ApiHandler
	private terminalManager: TerminalManager
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	contextManager: ContextManager
	private didEditFile: boolean = false
	customInstructions?: string
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	chatSettings: ChatSettings
	apiConversationHistory: Anthropic.MessageParam[] = []
	clineMessages: ClineMessage[] = []
	private clineIgnoreController: ClineIgnoreController
	private askResponse?: ClineAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	private askResponseFiles?: string[]
	private lastMessageTs?: number
	private consecutiveAutoApprovedRequestsCount: number = 0
	private consecutiveMistakeCount: number = 0
	private abort: boolean = false
	didFinishAbortingStream = false
	abandoned = false
	private diffViewProvider: DiffViewProvider
	private checkpointTracker?: CheckpointTracker
	checkpointTrackerErrorMessage?: string
	conversationHistoryDeletedRange?: [number, number]
	isInitialized = false
	isAwaitingPlanResponse = false
	didRespondToPlanAskBySwitchingMode = false

	// Metadata tracking
	private fileContextTracker: FileContextTracker
	private modelContextTracker: ModelContextTracker

	// streaming
	isWaitingForFirstChunk = false
	isStreaming = false
	private currentStreamingContentIndex = 0
	private assistantMessageContent: AssistantMessageContent[] = []
	private presentAssistantMessageLocked = false
	private presentAssistantMessageHasPendingUpdates = false
	private userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
	private userMessageContentReady = false
	private didRejectTool = false
	private didAlreadyUseTool = false
	private didCompleteReadingStream = false
	private didAutomaticallyRetryFailedApiRequest = false
	private enableCheckpoints: boolean

	constructor(
		context: vscode.ExtensionContext,
		mcpHub: McpHub,
		workspaceTracker: WorkspaceTracker,
		updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>,
		postStateToWebview: () => Promise<void>,
		postMessageToWebview: (message: ExtensionMessage) => Promise<void>,
		reinitExistingTaskFromId: (taskId: string) => Promise<void>,
		cancelTask: () => Promise<void>,
		apiConfiguration: ApiConfiguration,
		autoApprovalSettings: AutoApprovalSettings,
		browserSettings: BrowserSettings,
		chatSettings: ChatSettings,
		shellIntegrationTimeout: number,
		enableCheckpointsSetting: boolean,
		customInstructions?: string,
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
	) {
		this.context = context
		this.mcpHub = mcpHub
		this.workspaceTracker = workspaceTracker
		this.updateTaskHistory = updateTaskHistory
		this.postStateToWebview = postStateToWebview
		this.postMessageToWebview = postMessageToWebview
		this.reinitExistingTaskFromId = reinitExistingTaskFromId
		this.cancelTask = cancelTask
		this.clineIgnoreController = new ClineIgnoreController(cwd)
		// Initialization moved to startTask/resumeTaskFromHistory
		this.terminalManager = new TerminalManager()
		this.terminalManager.setShellIntegrationTimeout(shellIntegrationTimeout)
		this.urlContentFetcher = new UrlContentFetcher(context)
		this.browserSession = new BrowserSession(context, browserSettings)
		this.contextManager = new ContextManager()
		this.diffViewProvider = new DiffViewProvider(cwd)
		this.customInstructions = customInstructions
		this.autoApprovalSettings = autoApprovalSettings
		this.browserSettings = browserSettings
		this.chatSettings = chatSettings
		this.enableCheckpoints = enableCheckpointsSetting

		// Initialize taskId first
		if (historyItem) {
			this.taskId = historyItem.id
			this.taskIsFavorited = historyItem.isFavorited
			this.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
		} else if (task || images || files) {
			this.taskId = Date.now().toString()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		// Initialize file context tracker
		this.fileContextTracker = new FileContextTracker(context, this.taskId)
		this.modelContextTracker = new ModelContextTracker(context, this.taskId)

		// Prepare effective API configuration
		let effectiveApiConfiguration: ApiConfiguration = {
			...apiConfiguration,
			taskId: this.taskId,
			onRetryAttempt: (attempt: number, maxRetries: number, delay: number, error: any) => {
				const lastApiReqStartedIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")
				if (lastApiReqStartedIndex !== -1) {
					try {
						const currentApiReqInfo: ClineApiReqInfo = JSON.parse(
							this.clineMessages[lastApiReqStartedIndex].text || "{}",
						)
						currentApiReqInfo.retryStatus = {
							attempt: attempt, // attempt is already 1-indexed from retry.ts
							maxAttempts: maxRetries, // total attempts
							delaySec: Math.round(delay / 1000),
							errorSnippet: error?.message ? `${String(error.message).substring(0, 50)}...` : undefined,
						}
						// Clear previous cancelReason and streamingFailedMessage if we are retrying
						delete currentApiReqInfo.cancelReason
						delete currentApiReqInfo.streamingFailedMessage
						this.clineMessages[lastApiReqStartedIndex].text = JSON.stringify(currentApiReqInfo)

						// Post the updated state to the webview so the UI reflects the retry attempt
						this.postStateToWebview().catch((e) =>
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

	// Storing task to disk for history
	private async addToApiConversationHistory(message: Anthropic.MessageParam) {
		this.apiConversationHistory.push(message)
		await saveApiConversationHistory(this.getContext(), this.taskId, this.apiConversationHistory)
	}

	private async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]) {
		this.apiConversationHistory = newHistory
		await saveApiConversationHistory(this.getContext(), this.taskId, this.apiConversationHistory)
	}

	private async addToClineMessages(message: ClineMessage) {
		// these values allow us to reconstruct the conversation history at the time this cline message was created
		// it's important that apiConversationHistory is initialized before we add cline messages
		message.conversationHistoryIndex = this.apiConversationHistory.length - 1 // NOTE: this is the index of the last added message which is the user message, and once the clinemessages have been presented we update the apiconversationhistory with the completed assistant message. This means when resetting to a message, we need to +1 this index to get the correct assistant message that this tool use corresponds to
		message.conversationHistoryDeletedRange = this.conversationHistoryDeletedRange
		this.clineMessages.push(message)
		await this.saveClineMessagesAndUpdateHistory()
	}

	private async overwriteClineMessages(newMessages: ClineMessage[]) {
		this.clineMessages = newMessages
		await this.saveClineMessagesAndUpdateHistory()
	}

	private async saveClineMessagesAndUpdateHistory() {
		try {
			await saveClineMessages(this.getContext(), this.taskId, this.clineMessages)

			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.clineMessages.slice(1))))
			const taskMessage = this.clineMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.clineMessages[
					findLastIndex(this.clineMessages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))
				]
			const taskDir = await ensureTaskDirectoryExists(this.getContext(), this.taskId)
			let taskDirSize = 0
			try {
				// getFolderSize.loose silently ignores errors
				// returns # of bytes, size/1000/1000 = MB
				taskDirSize = await getFolderSize.loose(taskDir)
			} catch (error) {
				console.error("Failed to get task directory size:", taskDir, error)
			}
			await this.updateTaskHistory({
				id: this.taskId,
				ts: lastRelevantMessage.ts,
				task: taskMessage.text ?? "",
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
				size: taskDirSize,
				shadowGitConfigWorkTree: await this.checkpointTracker?.getShadowGitConfigWorkTree(),
				cwdOnTaskInitialization: cwd,
				conversationHistoryDeletedRange: this.conversationHistoryDeletedRange,
				isFavorited: this.taskIsFavorited,
			})
		} catch (error) {
			console.error("Failed to save cline messages:", error)
		}
	}

	async restoreCheckpoint(messageTs: number, restoreType: ClineCheckpointRestore, offset?: number) {
		const messageIndex = this.clineMessages.findIndex((m) => m.ts === messageTs) - (offset || 0)
		// Find the last message before messageIndex that has a lastCheckpointHash
		const lastHashIndex = findLastIndex(this.clineMessages.slice(0, messageIndex), (m) => m.lastCheckpointHash !== undefined)
		const message = this.clineMessages[messageIndex]
		const lastMessageWithHash = this.clineMessages[lastHashIndex]

		if (!message) {
			console.error("Message not found", this.clineMessages)
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

				if (!this.checkpointTracker && !this.checkpointTrackerErrorMessage) {
					try {
						this.checkpointTracker = await CheckpointTracker.create(
							this.taskId,
							this.context.globalStorageUri.fsPath,
							this.enableCheckpoints,
						)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						console.error("Failed to initialize checkpoint tracker:", errorMessage)
						this.checkpointTrackerErrorMessage = errorMessage
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
				}
				break
		}

		if (!didWorkspaceRestoreFail) {
			switch (restoreType) {
				case "task":
				case "taskAndWorkspace":
					this.conversationHistoryDeletedRange = message.conversationHistoryDeletedRange
					const newConversationHistory = this.apiConversationHistory.slice(
						0,
						(message.conversationHistoryIndex || 0) + 2,
					) // +1 since this index corresponds to the last user message, and another +1 since slice end index is exclusive
					await this.overwriteApiConversationHistory(newConversationHistory)

					// update the context history state
					await this.contextManager.truncateContextHistory(
						message.ts,
						await ensureTaskDirectoryExists(this.getContext(), this.taskId),
					)

					// aggregate deleted api reqs info so we don't lose costs/tokens
					const deletedMessages = this.clineMessages.slice(messageIndex + 1)
					const deletedApiReqsMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(deletedMessages)))

					const newClineMessages = this.clineMessages.slice(0, messageIndex + 1)
					await this.overwriteClineMessages(newClineMessages) // calls saveClineMessages which saves historyItem

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
				const checkpointMessages = this.clineMessages.filter((m) => m.say === "checkpoint_created")
				const currentMessageIndex = checkpointMessages.findIndex((m) => m.ts === messageTs)

				// Set isCheckpointCheckedOut to false for all checkpoint messages
				checkpointMessages.forEach((m, i) => {
					m.isCheckpointCheckedOut = i === currentMessageIndex
				})
			}

			await this.saveClineMessagesAndUpdateHistory()

			await this.postMessageToWebview({ type: "relinquishControl" })

			this.cancelTask() // the task is already cancelled by the provider beforehand, but we need to re-init to get the updated messages
		} else {
			await this.postMessageToWebview({ type: "relinquishControl" })
		}
	}

	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean) {
		const relinquishButton = () => {
			this.postMessageToWebview({ type: "relinquishControl" })
		}
		if (!this.enableCheckpoints) {
			vscode.window.showInformationMessage("Checkpoints are disabled in settings. Cannot show diff.")
			relinquishButton()
			return
		}

		console.log("presentMultifileDiff", messageTs)
		const messageIndex = this.clineMessages.findIndex((m) => m.ts === messageTs)
		const message = this.clineMessages[messageIndex]
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
		if (!this.checkpointTracker && this.enableCheckpoints && !this.checkpointTrackerErrorMessage) {
			try {
				this.checkpointTracker = await CheckpointTracker.create(
					this.taskId,
					this.context.globalStorageUri.fsPath,
					this.enableCheckpoints,
				)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				this.checkpointTrackerErrorMessage = errorMessage
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
					this.clineMessages.slice(0, messageIndex),
					(m) => m.say === "completion_result",
				)?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about
				// if undefined, then we get diff from beginning of git
				// if (!lastTaskCompletedMessage) {
				// 	console.error("No previous task completion message found")
				// 	return
				// }
				// This value *should* always exist
				const firstCheckpointMessageCheckpointHash = this.clineMessages.find(
					(m) => m.say === "checkpoint_created",
				)?.lastCheckpointHash

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

		const messageIndex = findLastIndex(this.clineMessages, (m) => m.say === "completion_result")
		const message = this.clineMessages[messageIndex]
		if (!message) {
			console.error("Completion message not found")
			return false
		}
		const hash = message.lastCheckpointHash
		if (!hash) {
			console.error("No checkpoint hash found")
			return false
		}

		if (this.enableCheckpoints && !this.checkpointTracker && !this.checkpointTrackerErrorMessage) {
			try {
				this.checkpointTracker = await CheckpointTracker.create(
					this.taskId,
					this.context.globalStorageUri.fsPath,
					this.enableCheckpoints,
				)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				return false
			}
		}

		// Get last task completed
		const lastTaskCompletedMessage = findLast(this.clineMessages.slice(0, messageIndex), (m) => m.say === "completion_result")

		try {
			// Get last task completed
			const lastTaskCompletedMessageCheckpointHash = lastTaskCompletedMessage?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about
			// if undefined, then we get diff from beginning of git
			// if (!lastTaskCompletedMessage) {
			// 	console.error("No previous task completion message found")
			// 	return
			// }
			// This value *should* always exist
			const firstCheckpointMessageCheckpointHash = this.clineMessages.find(
				(m) => m.say === "checkpoint_created",
			)?.lastCheckpointHash

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
		if (this.abort) {
			throw new Error("Cline instance aborted")
		}
		let askTs: number
		if (partial !== undefined) {
			const lastMessage = this.clineMessages.at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					lastMessage.text = text
					lastMessage.partial = partial
					// todo be more efficient about saving and posting only new data or one whole message at a time so ignore partial for saves, and only post parts of partial message instead of whole array in new listener
					// await this.saveClineMessagesAndUpdateHistory()
					// await this.postStateToWebview()
					await this.postMessageToWebview({
						type: "partialMessage",
						partialMessage: lastMessage,
					})
					throw new Error("Current ask promise was ignored 1")
				} else {
					// this is a new partial message, so add it with partial state
					// this.askResponse = undefined
					// this.askResponseText = undefined
					// this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({
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
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					this.askResponseFiles = undefined

					/*
					Bug for the history books:
					In the webview we use the ts as the chatrow key for the virtuoso list. Since we would update this ts right at the end of streaming, it would cause the view to flicker. The key prop has to be stable otherwise react has trouble reconciling items between renders, causing unmounting and remounting of components (flickering).
					The lesson here is if you see flickering when rendering lists, it's likely because the key prop is not stable.
					So in this case we must make sure that the message ts is never altered after first setting it.
					*/
					askTs = lastMessage.ts
					this.lastMessageTs = askTs
					// lastMessage.ts = askTs
					lastMessage.text = text
					lastMessage.partial = false
					await this.saveClineMessagesAndUpdateHistory()
					// await this.postStateToWebview()
					await this.postMessageToWebview({
						type: "partialMessage",
						partialMessage: lastMessage,
					})
				} else {
					// this is a new partial=false message, so add it like normal
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					this.askResponseFiles = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({
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
			this.askResponse = undefined
			this.askResponseText = undefined
			this.askResponseImages = undefined
			this.askResponseFiles = undefined
			askTs = Date.now()
			this.lastMessageTs = askTs
			await this.addToClineMessages({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
			})
			await this.postStateToWebview()
		}

		await pWaitFor(() => this.askResponse !== undefined || this.lastMessageTs !== askTs, { interval: 100 })
		if (this.lastMessageTs !== askTs) {
			throw new Error("Current ask promise was ignored") // could happen if we send multiple asks in a row i.e. with command_output. It's important that when we know an ask could fail, it is handled gracefully
		}
		const result = {
			response: this.askResponse!,
			text: this.askResponseText,
			images: this.askResponseImages,
			files: this.askResponseFiles,
		}
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined
		this.askResponseFiles = undefined
		return result
	}

	async handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[], files?: string[]) {
		this.askResponse = askResponse
		this.askResponseText = text
		this.askResponseImages = images
		this.askResponseFiles = files
	}

	async say(type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean): Promise<undefined> {
		if (this.abort) {
			throw new Error("Cline instance aborted")
		}

		if (partial !== undefined) {
			const lastMessage = this.clineMessages.at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files
					lastMessage.partial = partial
					await this.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
				} else {
					// this is a new partial message, so add it with partial state
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({
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
					this.lastMessageTs = lastMessage.ts
					// lastMessage.ts = sayTs
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files // Ensure files is updated
					lastMessage.partial = false

					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					await this.saveClineMessagesAndUpdateHistory()
					// await this.postStateToWebview()
					await this.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage }) // more performant than an entire postStateToWebview
				} else {
					// this is a new partial=false message, so add it like normal
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({
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
			this.lastMessageTs = sayTs
			await this.addToClineMessages({
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
		const lastMessage = this.clineMessages.at(-1)
		if (lastMessage?.partial && lastMessage.type === type && (lastMessage.ask === askOrSay || lastMessage.say === askOrSay)) {
			this.clineMessages.pop()
			await this.saveClineMessagesAndUpdateHistory()
			await this.postStateToWebview()
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
		this.clineMessages = []
		this.apiConversationHistory = []

		await this.postStateToWebview()

		await this.say("text", task, images, files)

		this.isInitialized = true

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

		const modifiedClineMessages = await getSavedClineMessages(this.getContext(), this.taskId)

		// Remove any resume messages that may have been added before
		const lastRelevantMessageIndex = findLastIndex(
			modifiedClineMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)
		if (lastRelevantMessageIndex !== -1) {
			modifiedClineMessages.splice(lastRelevantMessageIndex + 1)
		}

		// since we don't use api_req_finished anymore, we need to check if the last api_req_started has a cost value, if it doesn't and no cancellation reason to present, then we remove it since it indicates an api request without any partial content streamed
		const lastApiReqStartedIndex = findLastIndex(
			modifiedClineMessages,
			(m) => m.type === "say" && m.say === "api_req_started",
		)
		if (lastApiReqStartedIndex !== -1) {
			const lastApiReqStarted = modifiedClineMessages[lastApiReqStartedIndex]
			const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")
			if (cost === undefined && cancelReason === undefined) {
				modifiedClineMessages.splice(lastApiReqStartedIndex, 1)
			}
		}

		await this.overwriteClineMessages(modifiedClineMessages)
		this.clineMessages = await getSavedClineMessages(this.getContext(), this.taskId)

		// Now present the cline messages to the user and ask if they want to resume (NOTE: we ran into a bug before where the apiconversationhistory wouldn't be initialized when opening a old task, and it was because we were waiting for resume)
		// This is important in case the user deletes messages without resuming the task first
		this.apiConversationHistory = await getSavedApiConversationHistory(this.getContext(), this.taskId)

		// load the context history state
		await this.contextManager.initializeContextHistory(await ensureTaskDirectoryExists(this.getContext(), this.taskId))

		const lastClineMessage = this.clineMessages
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // could be multiple resume tasks

		let askType: ClineAsk
		if (lastClineMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else {
			askType = "resume_task"
		}

		this.isInitialized = true

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

		const [taskResumptionMessage, userResponseMessage] = formatResponse.taskResumption(
			this.chatSettings?.mode === "plan" ? "plan" : "act",
			agoText,
			cwd,
			wasRecent,
			responseText,
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

		await this.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.initiateTaskLoop(newUserContent)
	}

	private async initiateTaskLoop(userContent: UserContent): Promise<void> {
		let nextUserContent = userContent
		let includeFileDetails = true
		while (!this.abort) {
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
				this.consecutiveMistakeCount++
			}
		}
	}

	async abortTask() {
		this.abort = true // will stop any autonomously running promises
		this.terminalManager.disposeAll()
		this.urlContentFetcher.closeBrowser()
		await this.browserSession.dispose()
		this.clineIgnoreController.dispose()
		this.fileContextTracker.dispose()
		await this.diffViewProvider.revertChanges() // need to await for when we want to make sure directories/files are reverted before re-starting the task from a checkpoint
	}

	// Checkpoints

	async saveCheckpoint(isAttemptCompletionMessage: boolean = false) {
		if (!this.enableCheckpoints) {
			// If checkpoints are disabled, do nothing.
			return
		}
		// Set isCheckpointCheckedOut to false for all checkpoint_created messages
		this.clineMessages.forEach((message) => {
			if (message.say === "checkpoint_created") {
				message.isCheckpointCheckedOut = false
			}
		})

		if (!isAttemptCompletionMessage) {
			// ensure we aren't creating a duplicate checkpoint
			const lastMessage = this.clineMessages.at(-1)
			if (lastMessage?.say === "checkpoint_created") {
				return
			}

			// For non-attempt completion we just say checkpoints
			await this.say("checkpoint_created")
			this.checkpointTracker?.commit().then(async (commitHash) => {
				const lastCheckpointMessage = findLast(this.clineMessages, (m) => m.say === "checkpoint_created")
				if (lastCheckpointMessage) {
					lastCheckpointMessage.lastCheckpointHash = commitHash
					await this.saveClineMessagesAndUpdateHistory()
				}
			}) // silently fails for now

			//
		} else {
			// attempt completion requires checkpoint to be sync so that we can present button after attempt_completion
			const commitHash = await this.checkpointTracker?.commit()
			// For attempt_completion, find the last completion_result message and set its checkpoint hash. This will be used to present the 'see new changes' button
			const lastCompletionResultMessage = findLast(
				this.clineMessages,
				(m) => m.say === "completion_result" || m.ask === "completion_result",
			)
			if (lastCompletionResultMessage) {
				lastCompletionResultMessage.lastCheckpointHash = commitHash
				await this.saveClineMessagesAndUpdateHistory()
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
				cwd,
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

		const terminalInfo = await this.terminalManager.getOrCreateTerminal(cwd)
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
					// proceed while running
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

		let result = ""
		process.on("line", async (line) => {
			result += line + "\n"

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

		result = result.trim()

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

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: ToolUseName): boolean | [boolean, boolean] {
		if (this.autoApprovalSettings.enabled) {
			switch (toolName) {
				case "read_file":
				case "list_files":
				case "list_code_definition_names":
				case "search_files":
					return [
						this.autoApprovalSettings.actions.readFiles,
						this.autoApprovalSettings.actions.readFilesExternally ?? false,
					]
				case "new_rule":
				case "write_to_file":
				case "replace_in_file":
					return [
						this.autoApprovalSettings.actions.editFiles,
						this.autoApprovalSettings.actions.editFilesExternally ?? false,
					]
				case "execute_command":
					return [
						this.autoApprovalSettings.actions.executeSafeCommands ?? false,
						this.autoApprovalSettings.actions.executeAllCommands ?? false,
					]
				case "browser_action":
					return this.autoApprovalSettings.actions.useBrowser
				case "access_mcp_resource":
				case "use_mcp_tool":
					return this.autoApprovalSettings.actions.useMcp
			}
		}
		return false
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	shouldAutoApproveToolWithPath(blockname: ToolUseName, autoApproveActionpath: string | undefined): boolean {
		let isLocalRead: boolean = false
		if (autoApproveActionpath) {
			const absolutePath = path.resolve(cwd, autoApproveActionpath)
			isLocalRead = absolutePath.startsWith(cwd)
		} else {
			// If we do not get a path for some reason, default to a (safer) false return
			isLocalRead = false
		}

		// Get auto-approve settings for local and external edits
		const autoApproveResult = this.shouldAutoApproveTool(blockname)
		const [autoApproveLocal, autoApproveExternal] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		if ((isLocalRead && autoApproveLocal) || (!isLocalRead && autoApproveLocal && autoApproveExternal)) {
			return true
		} else {
			return false
		}
	}

	private formatErrorWithStatusCode(error: any): string {
		const statusCode = error.status || error.statusCode || (error.response && error.response.status)
		const message = error.message ?? JSON.stringify(serializeError(error), null, 2)

		// Only prepend the statusCode if it's not already part of the message
		return statusCode && !message.includes(statusCode.toString()) ? `${statusCode} - ${message}` : message
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

	private async isClaude4ModelFamily(): Promise<boolean> {
		const model = this.api.getModel()
		const modelId = model.id
		return modelId.includes("sonnet-4") || modelId.includes("opus-4")
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

		const isClaude4ModelFamily = await this.isClaude4ModelFamily()
		let systemPrompt = await SYSTEM_PROMPT(cwd, supportsBrowserUse, this.mcpHub, this.browserSettings, isClaude4ModelFamily)

		let settingsCustomInstructions = this.customInstructions?.trim()
		await this.migratePreferredLanguageToolSetting()
		const preferredLanguage = getLanguageKey(this.chatSettings.preferredLanguage as LanguageDisplay)
		const preferredLanguageInstructions =
			preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS
				? `# Preferred Language\n\nSpeak in ${preferredLanguage}.`
				: ""

		const { globalToggles, localToggles } = await refreshClineRulesToggles(this.getContext(), cwd)
		const { windsurfLocalToggles, cursorLocalToggles } = await refreshExternalRulesToggles(this.getContext(), cwd)

		const globalClineRulesFilePath = await ensureRulesDirectoryExists()
		const globalClineRulesFileInstructions = await getGlobalClineRules(globalClineRulesFilePath, globalToggles)

		const localClineRulesFileInstructions = await getLocalClineRules(cwd, localToggles)
		const [localCursorRulesFileInstructions, localCursorRulesDirInstructions] = await getLocalCursorRules(
			cwd,
			cursorLocalToggles,
		)
		const localWindsurfRulesFileInstructions = await getLocalWindsurfRules(cwd, windsurfLocalToggles)

		const clineIgnoreContent = this.clineIgnoreController.clineIgnoreContent
		let clineIgnoreInstructions: string | undefined
		if (clineIgnoreContent) {
			clineIgnoreInstructions = formatResponse.clineIgnoreInstructions(clineIgnoreContent)
		}

		if (
			settingsCustomInstructions ||
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
				settingsCustomInstructions,
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
			this.apiConversationHistory,
			this.clineMessages,
			this.api,
			this.conversationHistoryDeletedRange,
			previousApiReqIndex,
			await ensureTaskDirectoryExists(this.getContext(), this.taskId),
		)

		if (contextManagementMetadata.updatedConversationHistoryDeletedRange) {
			this.conversationHistoryDeletedRange = contextManagementMetadata.conversationHistoryDeletedRange
			await this.saveClineMessagesAndUpdateHistory() // saves task history item which we use to keep track of conversation history deleted range
		}

		let stream = this.api.createMessage(systemPrompt, contextManagementMetadata.truncatedConversationHistory)

		const iterator = stream[Symbol.asyncIterator]()

		try {
			// awaiting first chunk to see if it will throw an error
			this.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			yield firstChunk.value
			this.isWaitingForFirstChunk = false
		} catch (error) {
			const isOpenRouter = this.api instanceof OpenRouterHandler || this.api instanceof ClineHandler
			const isAnthropic = this.api instanceof AnthropicHandler
			const isOpenRouterContextWindowError = checkIsOpenRouterContextWindowError(error) && isOpenRouter
			const isAnthropicContextWindowError = checkIsAnthropicContextWindowError(error) && isAnthropic

			if (isAnthropic && isAnthropicContextWindowError && !this.didAutomaticallyRetryFailedApiRequest) {
				this.conversationHistoryDeletedRange = this.contextManager.getNextTruncationRange(
					this.apiConversationHistory,
					this.conversationHistoryDeletedRange,
					"quarter", // Force aggressive truncation
				)
				await this.saveClineMessagesAndUpdateHistory()
				await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
					Date.now(),
					await ensureTaskDirectoryExists(this.getContext(), this.taskId),
				)

				this.didAutomaticallyRetryFailedApiRequest = true
			} else if (isOpenRouter && !this.didAutomaticallyRetryFailedApiRequest) {
				if (isOpenRouterContextWindowError) {
					this.conversationHistoryDeletedRange = this.contextManager.getNextTruncationRange(
						this.apiConversationHistory,
						this.conversationHistoryDeletedRange,
						"quarter", // Force aggressive truncation
					)
					await this.saveClineMessagesAndUpdateHistory()
					await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
						Date.now(),
						await ensureTaskDirectoryExists(this.getContext(), this.taskId),
					)
				}

				console.log("first chunk failed, waiting 1 second before retrying")
				await setTimeoutPromise(1000)
				this.didAutomaticallyRetryFailedApiRequest = true
			} else {
				// request failed after retrying automatically once, ask user if they want to retry again
				// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.

				if (isOpenRouterContextWindowError || isAnthropicContextWindowError) {
					const truncatedConversationHistory = this.contextManager.getTruncatedMessages(
						this.apiConversationHistory,
						this.conversationHistoryDeletedRange,
					)

					// If the conversation has more than 3 messages, we can truncate again. If not, then the conversation is bricked.
					// ToDo: Allow the user to change their input if this is the case.
					if (truncatedConversationHistory.length > 3) {
						error = new Error("Context window exceeded. Click retry to truncate the conversation and try again.")
						this.didAutomaticallyRetryFailedApiRequest = false
					}
				}

				const errorMessage = this.formatErrorWithStatusCode(error)

				// Update the 'api_req_started' message to reflect final failure before asking user to manually retry
				const lastApiReqStartedIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")
				if (lastApiReqStartedIndex !== -1) {
					const currentApiReqInfo: ClineApiReqInfo = JSON.parse(this.clineMessages[lastApiReqStartedIndex].text || "{}")
					delete currentApiReqInfo.retryStatus

					this.clineMessages[lastApiReqStartedIndex].text = JSON.stringify({
						...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
						cancelReason: "retries_exhausted", // Indicate that automatic retries failed
						streamingFailedMessage: errorMessage,
					} satisfies ClineApiReqInfo)
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

	// Handle streaming JSON replacement for Claude 4 model family
	private async handleStreamingJsonReplacement(
		block: any,
		relPath: string,
		currentFullJson: string,
	): Promise<{ shouldBreak: boolean; newContent?: string; error?: string }> {
		// Calculate the delta - what's new since last time
		const newJsonChunk = currentFullJson.substring(this.lastProcessedJsonLength)

		if (block.partial) {
			// Initialize on first chunk
			if (!this.streamingJsonReplacer) {
				if (!this.diffViewProvider.isEditing) {
					await this.diffViewProvider.open(relPath)
				}

				// Set up callbacks
				const onContentUpdated = (newContent: string, _isFinalItem: boolean, changeLocation?: ChangeLocation) => {
					// Update diff view incrementally
					this.diffViewProvider.update(newContent, false, changeLocation)
				}

				const onError = (error: Error) => {
					console.error("StreamingJsonReplacer error:", error)
					// Handle error: push tool result, cleanup
					this.userMessageContent.push({
						type: "text",
						text: formatResponse.toolError(`JSON replacement error: ${error.message}`),
					})
					this.didAlreadyUseTool = true
					this.userMessageContentReady = true
					this.streamingJsonReplacer = undefined
					this.lastProcessedJsonLength = 0
					throw error
				}

				this.streamingJsonReplacer = new StreamingJsonReplacer(
					this.diffViewProvider.originalContent || "",
					onContentUpdated,
					onError,
				)
				this.lastProcessedJsonLength = 0
			}

			// Feed only the new chunk
			if (newJsonChunk.length > 0) {
				try {
					this.streamingJsonReplacer.write(newJsonChunk)
					this.lastProcessedJsonLength = currentFullJson.length
				} catch (e) {
					// Handle write error
					return { shouldBreak: true, error: `Write error: ${e}` }
				}

				const newContentParsed = this.streamingJsonReplacer.getSuccessfullyParsedItems()
			}

			return { shouldBreak: true } // Wait for more chunks
		} else {
			// Final chunk (!block.partial)
			if (!this.streamingJsonReplacer) {
				// JSON came all at once, initialize
				if (!this.diffViewProvider.isEditing) {
					await this.diffViewProvider.open(relPath)
				}
				// Would need to initialize StreamingJsonReplacer here for non-streaming case
				this.lastProcessedJsonLength = 0
				return { shouldBreak: true }
			}

			// Feed final delta
			if (newJsonChunk.length > 0) {
				this.streamingJsonReplacer.write(newJsonChunk)
			}

			const newContent = this.streamingJsonReplacer.getCurrentContent()

			// Get final list of replacements
			const allReplacements = this.streamingJsonReplacer.getSuccessfullyParsedItems()
			// console.log(`Total replacements applied: ${allReplacements.length}`)

			// Cleanup
			this.streamingJsonReplacer = undefined
			this.lastProcessedJsonLength = 0

			// Update diff view with final content
			await this.diffViewProvider.update(newContent, true)

			return { shouldBreak: false, newContent }
		}
	}

	async presentAssistantMessage() {
		if (this.abort) {
			throw new Error("Cline instance aborted")
		}

		if (this.presentAssistantMessageLocked) {
			this.presentAssistantMessageHasPendingUpdates = true
			return
		}
		this.presentAssistantMessageLocked = true
		this.presentAssistantMessageHasPendingUpdates = false

		if (this.currentStreamingContentIndex >= this.assistantMessageContent.length) {
			// this may happen if the last content block was completed before streaming could finish. if streaming is finished, and we're out of bounds then this means we already presented/executed the last content block and are ready to continue to next request
			if (this.didCompleteReadingStream) {
				this.userMessageContentReady = true
			}
			// console.log("no more content blocks to stream! this shouldn't happen?")
			this.presentAssistantMessageLocked = false
			return
			//throw new Error("No more content blocks to stream! This shouldn't happen...") // remove and just return after testing
		}

		const block = cloneDeep(this.assistantMessageContent[this.currentStreamingContentIndex]) // need to create copy bc while stream is updating the array, it could be updating the reference block properties too
		switch (block.type) {
			case "text": {
				if (this.didRejectTool || this.didAlreadyUseTool) {
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
				const toolDescription = () => {
					switch (block.name) {
						case "execute_command":
							return `[${block.name} for '${block.params.command}']`
						case "read_file":
							return `[${block.name} for '${block.params.path}']`
						case "write_to_file":
							return `[${block.name} for '${block.params.path}']`
						case "replace_in_file":
							return `[${block.name} for '${block.params.path}']`
						case "search_files":
							return `[${block.name} for '${block.params.regex}'${
								block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
							}]`
						case "list_files":
							return `[${block.name} for '${block.params.path}']`
						case "list_code_definition_names":
							return `[${block.name} for '${block.params.path}']`
						case "browser_action":
							return `[${block.name} for '${block.params.action}']`
						case "use_mcp_tool":
							return `[${block.name} for '${block.params.server_name}']`
						case "access_mcp_resource":
							return `[${block.name} for '${block.params.server_name}']`
						case "ask_followup_question":
							return `[${block.name} for '${block.params.question}']`
						case "plan_mode_respond":
							return `[${block.name}]`
						case "load_mcp_documentation":
							return `[${block.name}]`
						case "attempt_completion":
							return `[${block.name}]`
						case "new_task":
							return `[${block.name} for creating a new task]`
						case "condense":
							return `[${block.name}]`
						case "report_bug":
							return `[${block.name}]`
						case "new_rule":
							return `[${block.name} for '${block.params.path}']`
					}
				}

				if (this.didRejectTool) {
					// ignore any tool content after user has rejected tool once
					if (!block.partial) {
						this.userMessageContent.push({
							type: "text",
							text: `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`,
						})
					} else {
						// partial tool after user rejected a previous tool
						this.userMessageContent.push({
							type: "text",
							text: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`,
						})
					}
					break
				}

				if (this.didAlreadyUseTool) {
					// ignore any content after a tool has already been used
					this.userMessageContent.push({
						type: "text",
						text: formatResponse.toolAlreadyUsed(block.name),
					})
					break
				}

				const pushToolResult = (content: ToolResponse, isClaude4ModelFamily: boolean = false) => {
					if (typeof content === "string") {
						const resultText = content || "(tool did not return anything)"

						if (isClaude4ModelFamily) {
							// Claude 4 family: Use function_results format
							this.userMessageContent.push({
								type: "text",
								text: `<function_results>\n${resultText}\n</function_results>`,
							})
						} else {
							// Non-Claude 4: Use traditional format with header
							this.userMessageContent.push({
								type: "text",
								text: `${toolDescription()} Result:`,
							})
							this.userMessageContent.push({
								type: "text",
								text: resultText,
							})
						}
					} else {
						this.userMessageContent.push(...content)
					}
					// once a tool result has been collected, ignore all other tool uses since we should only ever present one tool result per message
					this.didAlreadyUseTool = true
				}

				// The user can approve, reject, or provide feedback (rejection). However the user may also send a message along with an approval, in which case we add a separate user message with this feedback.
				const pushAdditionalToolFeedback = (feedback?: string, images?: string[], fileContentString?: string) => {
					if (!feedback && (!images || images.length === 0) && !fileContentString) {
						return
					}
					const content = formatResponse.toolResult(
						`The user provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`,
						images,
						fileContentString,
					)
					if (typeof content === "string") {
						this.userMessageContent.push({
							type: "text",
							text: content,
						})
					} else {
						this.userMessageContent.push(...content)
					}
				}

				const askApproval = async (type: ClineAsk, partialMessage?: string) => {
					const { response, text, images, files } = await this.ask(type, partialMessage, false)
					if (response !== "yesButtonClicked") {
						// User pressed reject button or responded with a message, which we treat as a rejection
						pushToolResult(formatResponse.toolDenied())
						if (text || (images && images.length > 0) || (files && files.length > 0)) {
							let fileContentString = ""
							if (files && files.length > 0) {
								fileContentString = await processFilesIntoText(files)
							}

							pushAdditionalToolFeedback(text, images, fileContentString)
							await this.say("user_feedback", text, images, files)
							await this.saveCheckpoint()
						}
						this.didRejectTool = true // Prevent further tool uses in this message
						return false
					} else {
						// User hit the approve button, and may have provided feedback
						if (text || (images && images.length > 0) || (files && files.length > 0)) {
							let fileContentString = ""
							if (files && files.length > 0) {
								fileContentString = await processFilesIntoText(files)
							}

							pushAdditionalToolFeedback(text, images, fileContentString)
							await this.say("user_feedback", text, images, files)
							await this.saveCheckpoint()
						}
						return true
					}
				}

				const showNotificationForApprovalIfAutoApprovalEnabled = (message: string) => {
					if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
						showSystemNotification({
							subtitle: "Approval Required",
							message,
						})
					}
				}

				const handleError = async (action: string, error: Error, isClaude4ModelFamily: boolean = false) => {
					if (this.abandoned) {
						console.log("Ignoring error since task was abandoned (i.e. from task cancellation after resetting)")
						return
					}
					const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
					await this.say(
						"error",
						`Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`,
					)

					pushToolResult(formatResponse.toolError(errorString), isClaude4ModelFamily)
				}

				// If block is partial, remove partial closing tag so its not presented to user
				const removeClosingTag = (tag: ToolParamName, text?: string) => {
					if (!block.partial) {
						return text || ""
					}
					if (!text) {
						return ""
					}
					// This regex dynamically constructs a pattern to match the closing tag:
					// - Optionally matches whitespace before the tag
					// - Matches '<' or '</' optionally followed by any subset of characters from the tag name
					const tagRegex = new RegExp(
						`\\s?<\/?${tag
							.split("")
							.map((char) => `(?:${char})?`)
							.join("")}$`,
						"g",
					)
					return text.replace(tagRegex, "")
				}

				if (block.name !== "browser_action") {
					await this.browserSession.closeBrowser()
				}

				switch (block.name) {
					case "new_rule":
					case "write_to_file":
					case "replace_in_file": {
						const relPath: string | undefined = block.params.path
						let content: string | undefined = block.params.content // for write_to_file
						let diff: string | undefined = block.params.diff // for replace_in_file
						if (!relPath || (!content && !diff)) {
							// checking for content/diff ensures relPath is complete
							// wait so we can determine if it's a new file or editing an existing file
							break
						}

						const accessAllowed = this.clineIgnoreController.validateAccess(relPath)
						if (!accessAllowed) {
							await this.say("clineignore_error", relPath)
							pushToolResult(formatResponse.toolError(formatResponse.clineIgnoreError(relPath)))
							await this.saveCheckpoint()
							break
						}

						// Check if file exists using cached map or fs.access
						let fileExists: boolean
						if (this.diffViewProvider.editType !== undefined) {
							fileExists = this.diffViewProvider.editType === "modify"
						} else {
							const absolutePath = path.resolve(cwd, relPath)
							fileExists = await fileExistsAtPath(absolutePath)
							this.diffViewProvider.editType = fileExists ? "modify" : "create"
						}

						try {
							// Construct newContent from diff
							let newContent: string
							newContent = "" // default to original content if not editing
							if (diff) {
								if (!this.api.getModel().id.includes("claude")) {
									// deepseek models tend to use unescaped html entities in diffs
									diff = fixModelHtmlEscaping(diff)
									diff = removeInvalidChars(diff)
								}

								// open the editor if not done already.  This is to fix diff error when model provides correct search-replace text but Cline throws error
								// because file is not open.
								if (!this.diffViewProvider.isEditing) {
									await this.diffViewProvider.open(relPath)
								}

								const currentFullJson = block.params.diff
								// Check if we should use streaming (e.g., for specific models)
								const isClaude4ModelFamily = await this.isClaude4ModelFamily()

								// Going through claude family of models
								if (isClaude4ModelFamily && currentFullJson) {
									const streamingResult = await this.handleStreamingJsonReplacement(
										block,
										relPath,
										currentFullJson,
									)

									if (streamingResult.error) {
										await this.say("diff_error", relPath)
										pushToolResult(formatResponse.toolError(streamingResult.error))
										await this.diffViewProvider.revertChanges()
										await this.diffViewProvider.reset()
										await this.saveCheckpoint()
										break
									}

									if (streamingResult.shouldBreak) {
										break // Wait for more chunks or handle initialization
									}

									// If we get here, we have the final content
									if (streamingResult.newContent) {
										newContent = streamingResult.newContent
										// Continue with approval flow...
									}
								} else {
									try {
										newContent = await constructNewFileContent(
											diff,
											this.diffViewProvider.originalContent || "",
											!block.partial,
										)
									} catch (error) {
										await this.say("diff_error", relPath)

										// Extract error type from error message if possible, or use a generic type
										const errorType =
											error instanceof Error && error.message.includes("does not match anything")
												? "search_not_found"
												: "other_diff_error"

										// Add telemetry for diff edit failure
										telemetryService.captureDiffEditFailure(this.taskId, this.api.getModel().id, errorType)

										pushToolResult(
											formatResponse.toolError(
												`${(error as Error)?.message}\n\n` +
													formatResponse.diffError(relPath, this.diffViewProvider.originalContent),
											),
										)
										await this.diffViewProvider.revertChanges()
										await this.diffViewProvider.reset()
										await this.saveCheckpoint()
										break
									}
								}
							} else if (content) {
								newContent = content

								// pre-processing newContent for cases where weaker models might add artifacts like markdown codeblock markers (deepseek/llama) or extra escape characters (gemini)
								if (newContent.startsWith("```")) {
									// this handles cases where it includes language specifiers like ```python ```js
									newContent = newContent.split("\n").slice(1).join("\n").trim()
								}
								if (newContent.endsWith("```")) {
									newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
								}

								if (!this.api.getModel().id.includes("claude")) {
									// it seems not just llama models are doing this, but also gemini and potentially others
									newContent = fixModelHtmlEscaping(newContent)
									newContent = removeInvalidChars(newContent)
								}
							} else {
								// can't happen, since we already checked for content/diff above. but need to do this for type error
								break
							}

							newContent = newContent.trimEnd() // remove any trailing newlines, since it's automatically inserted by the editor

							const sharedMessageProps: ClineSayTool = {
								tool: fileExists ? "editedExistingFile" : "newFileCreated",
								path: getReadablePath(cwd, removeClosingTag("path", relPath)),
								content: diff || content,
								operationIsLocatedInWorkspace: isLocatedInWorkspace(relPath),
							}

							if (block.partial) {
								// update gui message
								const partialMessage = JSON.stringify(sharedMessageProps)

								if (this.shouldAutoApproveToolWithPath(block.name, relPath)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool") // in case the user changes auto-approval settings mid stream
									await this.say("tool", partialMessage, undefined, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									await this.ask("tool", partialMessage, block.partial).catch(() => {})
								}
								// update editor
								if (!this.diffViewProvider.isEditing) {
									// open the editor and prepare to stream content in
									await this.diffViewProvider.open(relPath)
								}
								// editor is open, stream content in
								await this.diffViewProvider.update(newContent, false)
								break
							} else {
								if (!relPath) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError(block.name, "path"))
									await this.diffViewProvider.reset()
									await this.saveCheckpoint()
									break
								}
								if (block.name === "replace_in_file" && !diff) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("replace_in_file", "diff"))
									await this.diffViewProvider.reset()
									await this.saveCheckpoint()
									break
								}
								if (block.name === "write_to_file" && !content) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("write_to_file", "content"))
									await this.diffViewProvider.reset()
									await this.saveCheckpoint()
									break
								}
								if (block.name === "new_rule" && !content) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("new_rule", "content"))
									await this.diffViewProvider.reset()
									await this.saveCheckpoint()
									break
								}

								this.consecutiveMistakeCount = 0

								// if isEditingFile false, that means we have the full contents of the file already.
								// it's important to note how this function works, you can't make the assumption that the block.partial conditional will always be called since it may immediately get complete, non-partial data. So this part of the logic will always be called.
								// in other words, you must always repeat the block.partial logic here
								if (!this.diffViewProvider.isEditing) {
									// show gui message before showing edit animation
									const partialMessage = JSON.stringify(sharedMessageProps)
									await this.ask("tool", partialMessage, true).catch(() => {}) // sending true for partial even though it's not a partial, this shows the edit row before the content is streamed into the editor
									await this.diffViewProvider.open(relPath)
								}
								await this.diffViewProvider.update(newContent, true)
								await setTimeoutPromise(300) // wait for diff view to update
								this.diffViewProvider.scrollToFirstDiff()
								// showOmissionWarning(this.diffViewProvider.originalContent || "", newContent)

								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: diff || content,
									operationIsLocatedInWorkspace: isLocatedInWorkspace(relPath),
									// ? formatResponse.createPrettyPatch(
									// 		relPath,
									// 		this.diffViewProvider.originalContent,
									// 		newContent,
									// 	)
									// : undefined,
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, relPath)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
									telemetryService.captureToolUsage(this.taskId, block.name, true, true)

									// we need an artificial delay to let the diagnostics catch up to the changes
									await setTimeoutPromise(3_500)
								} else {
									// If auto-approval is enabled but this tool wasn't auto-approved, send notification
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")

									// Need a more customized tool response for file edits to highlight the fact that the file was not updated (particularly important for deepseek)
									let didApprove = true
									const {
										response,
										text,
										images,
										files: askFiles,
									} = await this.ask("tool", completeMessage, false)
									if (response !== "yesButtonClicked") {
										// User either sent a message or pressed reject button
										// TODO: add similar context for other tool denial responses, to emphasize ie that a command was not run
										const fileDeniedNote = fileExists
											? "The file was not updated, and maintains its original contents."
											: "The file was not created."
										pushToolResult(`The user denied this operation. ${fileDeniedNote}`)
										if (text || (images && images.length > 0) || (askFiles && askFiles.length > 0)) {
											let fileContentString = ""
											if (askFiles && askFiles.length > 0) {
												fileContentString = await processFilesIntoText(askFiles)
											}

											pushAdditionalToolFeedback(text, images, fileContentString)
											await this.say("user_feedback", text, images, askFiles)
											await this.saveCheckpoint()
										}
										this.didRejectTool = true
										didApprove = false
										telemetryService.captureToolUsage(this.taskId, block.name, false, false)
									} else {
										// User hit the approve button, and may have provided feedback
										if (text || (images && images.length > 0) || (askFiles && askFiles.length > 0)) {
											let fileContentString = ""
											if (askFiles && askFiles.length > 0) {
												fileContentString = await processFilesIntoText(askFiles)
											}

											pushAdditionalToolFeedback(text, images, fileContentString)
											await this.say("user_feedback", text, images, askFiles)
											await this.saveCheckpoint()
										}
										telemetryService.captureToolUsage(this.taskId, block.name, false, true)
									}

									if (!didApprove) {
										await this.diffViewProvider.revertChanges()
										await this.saveCheckpoint()
										break
									}
								}

								// Mark the file as edited by Cline to prevent false "recently modified" warnings
								this.fileContextTracker.markFileAsEditedByCline(relPath)

								const { newProblemsMessage, userEdits, autoFormattingEdits, finalContent } =
									await this.diffViewProvider.saveChanges()
								this.didEditFile = true // used to determine if we should wait for busy terminal to update before sending api request

								// Track file edit operation
								await this.fileContextTracker.trackFileContext(relPath, "cline_edited")

								if (userEdits) {
									// Track file edit operation
									await this.fileContextTracker.trackFileContext(relPath, "user_edited")

									await this.say(
										"user_feedback_diff",
										JSON.stringify({
											tool: fileExists ? "editedExistingFile" : "newFileCreated",
											path: getReadablePath(cwd, relPath),
											diff: userEdits,
										} satisfies ClineSayTool),
									)
									pushToolResult(
										formatResponse.fileEditWithUserChanges(
											relPath,
											userEdits,
											autoFormattingEdits,
											finalContent,
											newProblemsMessage,
										),
									)
								} else {
									pushToolResult(
										formatResponse.fileEditWithoutUserChanges(
											relPath,
											autoFormattingEdits,
											finalContent,
											newProblemsMessage,
										),
									)
								}

								if (!fileExists) {
									this.workspaceTracker.populateFilePaths()
								}

								await this.diffViewProvider.reset()

								await this.saveCheckpoint()

								break
							}
						} catch (error) {
							await handleError("writing file", error)
							await this.diffViewProvider.revertChanges()
							await this.diffViewProvider.reset()
							await this.saveCheckpoint()
							break
						}
					}
					case "read_file": {
						const relPath: string | undefined = block.params.path
						const sharedMessageProps: ClineSayTool = {
							tool: "readFile",
							path: getReadablePath(cwd, removeClosingTag("path", relPath)),
						}
						try {
							if (block.partial) {
								const partialMessage = JSON.stringify({
									...sharedMessageProps,
									content: undefined,
									operationIsLocatedInWorkspace: isLocatedInWorkspace(relPath),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									await this.ask("tool", partialMessage, block.partial).catch(() => {})
								}
								break
							} else {
								if (!relPath) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("read_file", "path"))
									await this.saveCheckpoint()
									break
								}

								const accessAllowed = this.clineIgnoreController.validateAccess(relPath)
								if (!accessAllowed) {
									await this.say("clineignore_error", relPath)
									pushToolResult(formatResponse.toolError(formatResponse.clineIgnoreError(relPath)))
									await this.saveCheckpoint()
									break
								}

								this.consecutiveMistakeCount = 0
								const absolutePath = path.resolve(cwd, relPath)
								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: absolutePath,
									operationIsLocatedInWorkspace: isLocatedInWorkspace(relPath),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, undefined, false) // need to be sending partialValue bool, since undefined has its own purpose in that the message is treated neither as a partial or completion of a partial, but as a single complete message
									this.consecutiveAutoApprovedRequestsCount++
									telemetryService.captureToolUsage(this.taskId, block.name, true, true)
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to read ${path.basename(absolutePath)}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										await this.saveCheckpoint()
										telemetryService.captureToolUsage(this.taskId, block.name, false, false)
										break
									}
									telemetryService.captureToolUsage(this.taskId, block.name, false, true)
								}
								// now execute the tool like normal
								const content = await extractTextFromFile(absolutePath)

								// Track file read operation
								await this.fileContextTracker.trackFileContext(relPath, "read_tool")

								pushToolResult(content)
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("reading file", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "list_files": {
						const isClaude4ModelFamily = await this.isClaude4ModelFamily()
						const relDirPath: string | undefined = block.params.path
						const recursiveRaw: string | undefined = block.params.recursive
						const recursive = recursiveRaw?.toLowerCase() === "true"
						const sharedMessageProps: ClineSayTool = {
							tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
							path: getReadablePath(cwd, removeClosingTag("path", relDirPath)),
						}
						try {
							if (block.partial) {
								const partialMessage = JSON.stringify({
									...sharedMessageProps,
									content: "",
									operationIsLocatedInWorkspace: isLocatedInWorkspace(block.params.path),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									await this.ask("tool", partialMessage, block.partial).catch(() => {})
								}
								break
							} else {
								if (!relDirPath) {
									this.consecutiveMistakeCount++
									pushToolResult(
										await this.sayAndCreateMissingParamError("list_files", "path"),
										isClaude4ModelFamily,
									)
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0

								const absolutePath = path.resolve(cwd, relDirPath)

								const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)

								const result = formatResponse.formatFilesList(
									absolutePath,
									files,
									didHitLimit,
									this.clineIgnoreController,
								)
								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: result,
									operationIsLocatedInWorkspace: isLocatedInWorkspace(block.params.path),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
									telemetryService.captureToolUsage(this.taskId, block.name, true, true)
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to view directory ${path.basename(absolutePath)}/`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										telemetryService.captureToolUsage(this.taskId, block.name, false, false)
										await this.saveCheckpoint()
										break
									}
									telemetryService.captureToolUsage(this.taskId, block.name, false, true)
								}
								pushToolResult(result, isClaude4ModelFamily)
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("listing files", error, isClaude4ModelFamily)
							await this.saveCheckpoint()
							break
						}
					}
					case "list_code_definition_names": {
						const relDirPath: string | undefined = block.params.path
						const sharedMessageProps: ClineSayTool = {
							tool: "listCodeDefinitionNames",
							path: getReadablePath(cwd, removeClosingTag("path", relDirPath)),
						}
						try {
							if (block.partial) {
								const partialMessage = JSON.stringify({
									...sharedMessageProps,
									content: "",
									operationIsLocatedInWorkspace: isLocatedInWorkspace(block.params.path),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									await this.ask("tool", partialMessage, block.partial).catch(() => {})
								}
								break
							} else {
								if (!relDirPath) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("list_code_definition_names", "path"))
									await this.saveCheckpoint()
									break
								}

								this.consecutiveMistakeCount = 0

								const absolutePath = path.resolve(cwd, relDirPath)
								const result = await parseSourceCodeForDefinitionsTopLevel(
									absolutePath,
									this.clineIgnoreController,
								)

								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: result,
									operationIsLocatedInWorkspace: isLocatedInWorkspace(block.params.path),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
									telemetryService.captureToolUsage(this.taskId, block.name, true, true)
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to view source code definitions in ${path.basename(absolutePath)}/`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										telemetryService.captureToolUsage(this.taskId, block.name, false, false)
										await this.saveCheckpoint()
										break
									}
									telemetryService.captureToolUsage(this.taskId, block.name, false, true)
								}
								pushToolResult(result)
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("parsing source code definitions", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "search_files": {
						const relDirPath: string | undefined = block.params.path
						const regex: string | undefined = block.params.regex
						const filePattern: string | undefined = block.params.file_pattern
						const sharedMessageProps: ClineSayTool = {
							tool: "searchFiles",
							path: getReadablePath(cwd, removeClosingTag("path", relDirPath)),
							regex: removeClosingTag("regex", regex),
							filePattern: removeClosingTag("file_pattern", filePattern),
						}
						try {
							if (block.partial) {
								const partialMessage = JSON.stringify({
									...sharedMessageProps,
									content: "",
									operationIsLocatedInWorkspace: isLocatedInWorkspace(block.params.path),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									await this.ask("tool", partialMessage, block.partial).catch(() => {})
								}
								break
							} else {
								if (!relDirPath) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("search_files", "path"))
									await this.saveCheckpoint()
									break
								}
								if (!regex) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("search_files", "regex"))
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0

								const absolutePath = path.resolve(cwd, relDirPath)
								const results = await regexSearchFiles(
									cwd,
									absolutePath,
									regex,
									filePattern,
									this.clineIgnoreController,
								)

								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: results,
									operationIsLocatedInWorkspace: isLocatedInWorkspace(block.params.path),
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
									telemetryService.captureToolUsage(this.taskId, block.name, true, true)
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to search files in ${path.basename(absolutePath)}/`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										telemetryService.captureToolUsage(this.taskId, block.name, false, false)
										await this.saveCheckpoint()
										break
									}
									telemetryService.captureToolUsage(this.taskId, block.name, false, true)
								}
								pushToolResult(results)
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("searching files", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "browser_action": {
						const action: BrowserAction | undefined = block.params.action as BrowserAction
						const url: string | undefined = block.params.url
						const coordinate: string | undefined = block.params.coordinate
						const text: string | undefined = block.params.text
						if (!action || !browserActions.includes(action)) {
							// checking for action to ensure it is complete and valid
							if (!block.partial) {
								// if the block is complete and we don't have a valid action this is a mistake
								this.consecutiveMistakeCount++
								pushToolResult(await this.sayAndCreateMissingParamError("browser_action", "action"))
								await this.browserSession.closeBrowser()
								await this.saveCheckpoint()
							}
							break
						}

						try {
							if (block.partial) {
								if (action === "launch") {
									if (this.shouldAutoApproveTool(block.name)) {
										this.removeLastPartialMessageIfExistsWithType("ask", "browser_action_launch")
										await this.say(
											"browser_action_launch",
											removeClosingTag("url", url),
											undefined,
											undefined,
											block.partial,
										)
									} else {
										this.removeLastPartialMessageIfExistsWithType("say", "browser_action_launch")
										await this.ask(
											"browser_action_launch",
											removeClosingTag("url", url),
											block.partial,
										).catch(() => {})
									}
								} else {
									await this.say(
										"browser_action",
										JSON.stringify({
											action: action as BrowserAction,
											coordinate: removeClosingTag("coordinate", coordinate),
											text: removeClosingTag("text", text),
										} satisfies ClineSayBrowserAction),
										undefined,
										undefined,
										block.partial,
									)
								}
								break
							} else {
								let browserActionResult: BrowserActionResult
								if (action === "launch") {
									if (!url) {
										this.consecutiveMistakeCount++
										pushToolResult(await this.sayAndCreateMissingParamError("browser_action", "url"))
										await this.browserSession.closeBrowser()
										await this.saveCheckpoint()
										break
									}
									this.consecutiveMistakeCount = 0

									if (this.shouldAutoApproveTool(block.name)) {
										this.removeLastPartialMessageIfExistsWithType("ask", "browser_action_launch")
										await this.say("browser_action_launch", url, undefined, undefined, false)
										this.consecutiveAutoApprovedRequestsCount++
									} else {
										showNotificationForApprovalIfAutoApprovalEnabled(
											`Cline wants to use a browser and launch ${url}`,
										)
										this.removeLastPartialMessageIfExistsWithType("say", "browser_action_launch")
										const didApprove = await askApproval("browser_action_launch", url)
										if (!didApprove) {
											await this.saveCheckpoint()
											break
										}
									}

									// NOTE: it's okay that we call this message since the partial inspect_site is finished streaming. The only scenario we have to avoid is sending messages WHILE a partial message exists at the end of the messages array. For example the api_req_finished message would interfere with the partial message, so we needed to remove that.
									// await this.say("inspect_site_result", "") // no result, starts the loading spinner waiting for result
									await this.say("browser_action_result", "") // starts loading spinner

									// Re-make browserSession to make sure latest settings apply
									if (this.context) {
										await this.browserSession.dispose()
										this.browserSession = new BrowserSession(this.context, this.browserSettings)
									} else {
										console.warn("no controller context available for browserSession")
									}
									await this.browserSession.launchBrowser()
									browserActionResult = await this.browserSession.navigateToUrl(url)
								} else {
									if (action === "click") {
										if (!coordinate) {
											this.consecutiveMistakeCount++
											pushToolResult(
												await this.sayAndCreateMissingParamError("browser_action", "coordinate"),
											)
											await this.browserSession.closeBrowser()
											await this.saveCheckpoint()
											break // can't be within an inner switch
										}
									}
									if (action === "type") {
										if (!text) {
											this.consecutiveMistakeCount++
											pushToolResult(await this.sayAndCreateMissingParamError("browser_action", "text"))
											await this.browserSession.closeBrowser()
											await this.saveCheckpoint()
											break
										}
									}
									this.consecutiveMistakeCount = 0
									await this.say(
										"browser_action",
										JSON.stringify({
											action: action as BrowserAction,
											coordinate,
											text,
										} satisfies ClineSayBrowserAction),
										undefined,
										undefined,
										false,
									)
									switch (action) {
										case "click":
											browserActionResult = await this.browserSession.click(coordinate!)
											break
										case "type":
											browserActionResult = await this.browserSession.type(text!)
											break
										case "scroll_down":
											browserActionResult = await this.browserSession.scrollDown()
											break
										case "scroll_up":
											browserActionResult = await this.browserSession.scrollUp()
											break
										case "close":
											browserActionResult = await this.browserSession.closeBrowser()
											break
									}
								}

								switch (action) {
									case "launch":
									case "click":
									case "type":
									case "scroll_down":
									case "scroll_up":
										await this.say("browser_action_result", JSON.stringify(browserActionResult))
										pushToolResult(
											formatResponse.toolResult(
												`The browser action has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${
													browserActionResult.logs || "(No new logs)"
												}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close this browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`,
												browserActionResult.screenshot ? [browserActionResult.screenshot] : [],
											),
										)
										await this.saveCheckpoint()
										break
									case "close":
										pushToolResult(
											formatResponse.toolResult(
												`The browser has been closed. You may now proceed to using other tools.`,
											),
										)
										await this.saveCheckpoint()
										break
								}

								break
							}
						} catch (error) {
							await this.browserSession.closeBrowser() // if any error occurs, the browser session is terminated
							await handleError("executing browser action", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "execute_command": {
						let command: string | undefined = block.params.command
						const requiresApprovalRaw: string | undefined = block.params.requires_approval
						const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"

						try {
							if (block.partial) {
								if (this.shouldAutoApproveTool(block.name)) {
									// since depending on an upcoming parameter, requiresApproval this may become an ask - we can't partially stream a say prematurely. So in this particular case we have to wait for the requiresApproval parameter to be completed before presenting it.
									// await this.say(
									// 	"command",
									// 	removeClosingTag("command", command),
									// 	undefined,
									// 	block.partial,
									// ).catch(() => {})
								} else {
									// don't need to remove last partial since we couldn't have streamed a say
									await this.ask("command", removeClosingTag("command", command), block.partial).catch(() => {})
								}
								break
							} else {
								if (!command) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("execute_command", "command"))
									await this.saveCheckpoint()
									break
								}
								if (!requiresApprovalRaw) {
									this.consecutiveMistakeCount++
									pushToolResult(
										await this.sayAndCreateMissingParamError("execute_command", "requires_approval"),
									)
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0

								// gemini models tend to use unescaped html entities in commands
								if (this.api.getModel().id.includes("gemini")) {
									command = fixModelHtmlEscaping(command)
								}

								const ignoredFileAttemptedToAccess = this.clineIgnoreController.validateCommand(command)
								if (ignoredFileAttemptedToAccess) {
									await this.say("clineignore_error", ignoredFileAttemptedToAccess)
									pushToolResult(
										formatResponse.toolError(formatResponse.clineIgnoreError(ignoredFileAttemptedToAccess)),
									)
									await this.saveCheckpoint()
									break
								}

								let didAutoApprove = false

								// If the model says this command is safe and auto approval for safe commands is true, execute the command
								// If the model says the command is risky, but *BOTH* auto approve settings are true, execute the command
								const autoApproveResult = this.shouldAutoApproveTool(block.name)
								const [autoApproveSafe, autoApproveAll] = Array.isArray(autoApproveResult)
									? autoApproveResult
									: [autoApproveResult, false]

								if (
									(!requiresApprovalPerLLM && autoApproveSafe) ||
									(requiresApprovalPerLLM && autoApproveSafe && autoApproveAll)
								) {
									this.removeLastPartialMessageIfExistsWithType("ask", "command")
									await this.say("command", command, undefined, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
									didAutoApprove = true
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to execute a command: ${command}`,
									)
									// this.removeLastPartialMessageIfExistsWithType("say", "command")
									const didApprove = await askApproval(
										"command",
										command +
											`${this.shouldAutoApproveTool(block.name) && requiresApprovalPerLLM ? COMMAND_REQ_APP_STRING : ""}`, // ugly hack until we refactor combineCommandSequences
									)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
								}

								let timeoutId: NodeJS.Timeout | undefined
								if (didAutoApprove && this.autoApprovalSettings.enableNotifications) {
									// if the command was auto-approved, and it's long running we need to notify the user after some time has passed without proceeding
									timeoutId = setTimeout(() => {
										showSystemNotification({
											subtitle: "Command is still running",
											message:
												"An auto-approved command has been running for 30s, and may need your attention.",
										})
									}, 30_000)
								}

								const [userRejected, result] = await this.executeCommandTool(command)
								if (timeoutId) {
									clearTimeout(timeoutId)
								}
								if (userRejected) {
									this.didRejectTool = true
								}

								// Re-populate file paths in case the command modified the workspace (vscode listeners do not trigger unless the user manually creates/deletes files)
								this.workspaceTracker.populateFilePaths()

								pushToolResult(result)

								await this.saveCheckpoint()

								break
							}
						} catch (error) {
							await handleError("executing command", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "use_mcp_tool": {
						const server_name: string | undefined = block.params.server_name
						const tool_name: string | undefined = block.params.tool_name
						const mcp_arguments: string | undefined = block.params.arguments
						try {
							if (block.partial) {
								const partialMessage = JSON.stringify({
									type: "use_mcp_tool",
									serverName: removeClosingTag("server_name", server_name),
									toolName: removeClosingTag("tool_name", tool_name),
									arguments: removeClosingTag("arguments", mcp_arguments),
								} satisfies ClineAskUseMcpServer)

								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
									await this.say("use_mcp_server", partialMessage, undefined, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
									await this.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
								}

								break
							} else {
								if (!server_name) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("use_mcp_tool", "server_name"))
									await this.saveCheckpoint()
									break
								}
								if (!tool_name) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("use_mcp_tool", "tool_name"))
									await this.saveCheckpoint()
									break
								}
								// arguments are optional, but if they are provided they must be valid JSON
								// if (!mcp_arguments) {
								// 	this.consecutiveMistakeCount++
								// 	pushToolResult(await this.sayAndCreateMissingParamError("use_mcp_tool", "arguments"))
								// 	break
								// }
								let parsedArguments: Record<string, unknown> | undefined
								if (mcp_arguments) {
									try {
										parsedArguments = JSON.parse(mcp_arguments)
									} catch (error) {
										this.consecutiveMistakeCount++
										await this.say(
											"error",
											`Cline tried to use ${tool_name} with an invalid JSON argument. Retrying...`,
										)
										pushToolResult(
											formatResponse.toolError(
												formatResponse.invalidMcpToolArgumentError(server_name, tool_name),
											),
										)
										await this.saveCheckpoint()
										break
									}
								}
								this.consecutiveMistakeCount = 0
								const completeMessage = JSON.stringify({
									type: "use_mcp_tool",
									serverName: server_name,
									toolName: tool_name,
									arguments: mcp_arguments,
								} satisfies ClineAskUseMcpServer)

								const isToolAutoApproved = this.mcpHub.connections
									?.find((conn) => conn.server.name === server_name)
									?.server.tools?.find((tool) => tool.name === tool_name)?.autoApprove

								if (this.shouldAutoApproveTool(block.name) && isToolAutoApproved) {
									this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
									await this.say("use_mcp_server", completeMessage, undefined, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to use ${tool_name} on ${server_name}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
									const didApprove = await askApproval("use_mcp_server", completeMessage)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
								}

								// now execute the tool
								await this.say("mcp_server_request_started") // same as browser_action_result
								const toolResult = await this.mcpHub.callTool(server_name, tool_name, parsedArguments)

								// TODO: add progress indicator

								const toolResultImages =
									toolResult?.content
										.filter((item) => item.type === "image")
										.map((item) => `data:${item.mimeType};base64,${item.data}`) || []
								let toolResultText =
									(toolResult?.isError ? "Error:\n" : "") +
										toolResult?.content
											.map((item) => {
												if (item.type === "text") {
													return item.text
												}
												if (item.type === "resource") {
													const { blob, ...rest } = item.resource
													return JSON.stringify(rest, null, 2)
												}
												return ""
											})
											.filter(Boolean)
											.join("\n\n") || "(No response)"
								// webview extracts images from the text response to display in the UI
								const toolResultToDisplay =
									toolResultText + toolResultImages?.map((image) => `\n\n${image}`).join("")
								await this.say("mcp_server_response", toolResultToDisplay)

								// MCP's might return images to display to the user, but the model may not support them
								const supportsImages = this.api.getModel().info.supportsImages ?? false
								if (toolResultImages.length > 0 && !supportsImages) {
									toolResultText += `\n\n[${toolResultImages.length} images were provided in the response, and while they are displayed to the user, you do not have the ability to view them.]`
								}

								// only passes in images if model supports them
								pushToolResult(
									formatResponse.toolResult(toolResultText, supportsImages ? toolResultImages : undefined),
								)

								await this.saveCheckpoint()

								break
							}
						} catch (error) {
							await handleError("executing MCP tool", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "access_mcp_resource": {
						const server_name: string | undefined = block.params.server_name
						const uri: string | undefined = block.params.uri
						try {
							if (block.partial) {
								const partialMessage = JSON.stringify({
									type: "access_mcp_resource",
									serverName: removeClosingTag("server_name", server_name),
									uri: removeClosingTag("uri", uri),
								} satisfies ClineAskUseMcpServer)

								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
									await this.say("use_mcp_server", partialMessage, undefined, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
									await this.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
								}

								break
							} else {
								if (!server_name) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("access_mcp_resource", "server_name"))
									await this.saveCheckpoint()
									break
								}
								if (!uri) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("access_mcp_resource", "uri"))
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0
								const completeMessage = JSON.stringify({
									type: "access_mcp_resource",
									serverName: server_name,
									uri,
								} satisfies ClineAskUseMcpServer)

								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
									await this.say("use_mcp_server", completeMessage, undefined, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to access ${uri} on ${server_name}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
									const didApprove = await askApproval("use_mcp_server", completeMessage)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
								}

								// now execute the tool
								await this.say("mcp_server_request_started")
								const resourceResult = await this.mcpHub.readResource(server_name, uri)
								const resourceResultPretty =
									resourceResult?.contents
										.map((item) => {
											if (item.text) {
												return item.text
											}
											return ""
										})
										.filter(Boolean)
										.join("\n\n") || "(Empty response)"
								await this.say("mcp_server_response", resourceResultPretty)
								pushToolResult(formatResponse.toolResult(resourceResultPretty))
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("accessing MCP resource", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "ask_followup_question": {
						const question: string | undefined = block.params.question
						const optionsRaw: string | undefined = block.params.options
						const sharedMessage = {
							question: removeClosingTag("question", question),
							options: parsePartialArrayString(removeClosingTag("options", optionsRaw)),
						} satisfies ClineAskQuestion
						try {
							if (block.partial) {
								await this.ask("followup", JSON.stringify(sharedMessage), block.partial).catch(() => {})
								break
							} else {
								if (!question) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("ask_followup_question", "question"))
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0

								if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
									showSystemNotification({
										subtitle: "Cline has a question...",
										message: question.replace(/\n/g, " "),
									})
								}

								// Store the number of options for telemetry
								const options = parsePartialArrayString(optionsRaw || "[]")

								const {
									text,
									images,
									files: followupFiles,
								} = await this.ask("followup", JSON.stringify(sharedMessage), false)

								// Check if options contains the text response
								if (optionsRaw && text && parsePartialArrayString(optionsRaw).includes(text)) {
									// Valid option selected, don't show user message in UI
									// Update last followup message with selected option
									const lastFollowupMessage = findLast(this.clineMessages, (m) => m.ask === "followup")
									if (lastFollowupMessage) {
										lastFollowupMessage.text = JSON.stringify({
											...sharedMessage,
											selected: text,
										} satisfies ClineAskQuestion)
										await this.saveClineMessagesAndUpdateHistory()
										telemetryService.captureOptionSelected(this.taskId, options.length, "act")
									}
								} else {
									// Option not selected, send user feedback
									telemetryService.captureOptionsIgnored(this.taskId, options.length, "act")
									await this.say("user_feedback", text ?? "", images, followupFiles)
								}

								let fileContentString = ""
								if (followupFiles && followupFiles.length > 0) {
									fileContentString = await processFilesIntoText(followupFiles)
								}

								pushToolResult(
									formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images, fileContentString),
								)
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("asking question", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "new_task": {
						const context: string | undefined = block.params.context
						try {
							if (block.partial) {
								await this.ask("new_task", removeClosingTag("context", context), block.partial).catch(() => {})
								break
							} else {
								if (!context) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("new_task", "context"))
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0

								if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
									showSystemNotification({
										subtitle: "Cline wants to start a new task...",
										message: `Cline is suggesting to start a new task with: ${context}`,
									})
								}

								const { text, images, files: newTaskFiles } = await this.ask("new_task", context, false)

								// If the user provided a response, treat it as feedback
								if (text || (images && images.length > 0) || (newTaskFiles && newTaskFiles.length > 0)) {
									let fileContentString = ""
									if (newTaskFiles && newTaskFiles.length > 0) {
										fileContentString = await processFilesIntoText(newTaskFiles)
									}

									await this.say("user_feedback", text ?? "", images, newTaskFiles)
									pushToolResult(
										formatResponse.toolResult(
											`The user provided feedback instead of creating a new task:\n<feedback>\n${text}\n</feedback>`,
											images,
											fileContentString,
										),
									)
								} else {
									// If no response, the user clicked the "Create New Task" button
									pushToolResult(
										formatResponse.toolResult(`The user has created a new task with the provided context.`),
									)
								}
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("creating new task", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "condense": {
						const context: string | undefined = block.params.context
						try {
							if (block.partial) {
								await this.ask("condense", removeClosingTag("context", context), block.partial).catch(() => {})
								break
							} else {
								if (!context) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("condense", "context"))
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0

								if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
									showSystemNotification({
										subtitle: "Cline wants to condense the conversation...",
										message: `Cline is suggesting to condense your conversation with: ${context}`,
									})
								}

								const { text, images, files: condenseFiles } = await this.ask("condense", context, false)

								// If the user provided a response, treat it as feedback
								if (text || (images && images.length > 0) || (condenseFiles && condenseFiles.length > 0)) {
									let fileContentString = ""
									if (condenseFiles && condenseFiles.length > 0) {
										fileContentString = await processFilesIntoText(condenseFiles)
									}

									await this.say("user_feedback", text ?? "", images, condenseFiles)
									pushToolResult(
										formatResponse.toolResult(
											`The user provided feedback on the condensed conversation summary:\n<feedback>\n${text}\n</feedback>`,
											images,
											fileContentString,
										),
									)
								} else {
									// If no response, the user accepted the condensed version
									pushToolResult(formatResponse.toolResult(formatResponse.condense()))

									const lastMessage = this.apiConversationHistory[this.apiConversationHistory.length - 1]
									const summaryAlreadyAppended = lastMessage && lastMessage.role === "assistant"
									const keepStrategy = summaryAlreadyAppended ? "lastTwo" : "none"

									// clear the context history at this point in time
									this.conversationHistoryDeletedRange = this.contextManager.getNextTruncationRange(
										this.apiConversationHistory,
										this.conversationHistoryDeletedRange,
										keepStrategy,
									)
									await this.saveClineMessagesAndUpdateHistory()
									await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
										Date.now(),
										await ensureTaskDirectoryExists(this.getContext(), this.taskId),
									)
								}
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("condensing context window", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "report_bug": {
						const title = block.params.title
						const what_happened = block.params.what_happened
						const steps_to_reproduce = block.params.steps_to_reproduce
						const api_request_output = block.params.api_request_output
						const additional_context = block.params.additional_context

						try {
							if (block.partial) {
								await this.ask(
									"report_bug",
									JSON.stringify({
										title: removeClosingTag("title", title),
										what_happened: removeClosingTag("what_happened", what_happened),
										steps_to_reproduce: removeClosingTag("steps_to_reproduce", steps_to_reproduce),
										api_request_output: removeClosingTag("api_request_output", api_request_output),
										additional_context: removeClosingTag("additional_context", additional_context),
									}),
									block.partial,
								).catch(() => {})
								break
							} else {
								if (!title) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "title"))
									await this.saveCheckpoint()
									break
								}
								if (!what_happened) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "what_happened"))
									await this.saveCheckpoint()
									break
								}
								if (!steps_to_reproduce) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "steps_to_reproduce"))
									await this.saveCheckpoint()
									break
								}
								if (!api_request_output) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "api_request_output"))
									await this.saveCheckpoint()
									break
								}
								if (!additional_context) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "additional_context"))
									await this.saveCheckpoint()
									break
								}

								this.consecutiveMistakeCount = 0

								if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
									showSystemNotification({
										subtitle: "Cline wants to create a github issue...",
										message: `Cline is suggesting to create a github issue with the title: ${title}`,
									})
								}

								// Derive system information values algorithmically
								const operatingSystem = os.platform() + " " + os.release()
								const clineVersion =
									vscode.extensions.getExtension("saoudrizwan.claude-dev")?.packageJSON.version || "Unknown"
								const systemInfo = `VSCode: ${vscode.version}, Node.js: ${process.version}, Architecture: ${os.arch()}`
								const providerAndModel = `${(await getGlobalState(this.getContext(), "apiProvider")) as string} / ${this.api.getModel().id}`

								// Ask user for confirmation
								const bugReportData = JSON.stringify({
									title,
									what_happened,
									steps_to_reproduce,
									api_request_output,
									additional_context,
									// Include derived values in the JSON for display purposes
									provider_and_model: providerAndModel,
									operating_system: operatingSystem,
									system_info: systemInfo,
									cline_version: clineVersion,
								})

								const { text, images, files: reportBugFiles } = await this.ask("report_bug", bugReportData, false)

								// If the user provided a response, treat it as feedback
								if (text || (images && images.length > 0) || (reportBugFiles && reportBugFiles.length > 0)) {
									let fileContentString = ""
									if (reportBugFiles && reportBugFiles.length > 0) {
										fileContentString = await processFilesIntoText(reportBugFiles)
									}

									await this.say("user_feedback", text ?? "", images, reportBugFiles)
									pushToolResult(
										formatResponse.toolResult(
											`The user did not submit the bug, and provided feedback on the Github issue generated instead:\n<feedback>\n${text}\n</feedback>`,
											images,
											fileContentString,
										),
									)
								} else {
									// If no response, the user accepted the condensed version
									pushToolResult(
										formatResponse.toolResult(`The user accepted the creation of the Github issue.`),
									)

									try {
										// Create a Map of parameters for the GitHub issue
										const params = new Map<string, string>()
										params.set("title", title)
										params.set("operating-system", operatingSystem)
										params.set("cline-version", clineVersion)
										params.set("system-info", systemInfo)
										params.set("additional-context", additional_context)
										params.set("what-happened", what_happened)
										params.set("steps", steps_to_reproduce)
										params.set("provider-model", providerAndModel)
										params.set("logs", api_request_output)

										// Use our utility function to create and open the GitHub issue URL
										// This bypasses VS Code's URI handling issues with special characters
										await createAndOpenGitHubIssue("cline", "cline", "bug_report.yml", params)
									} catch (error) {
										console.error(`An error occurred while attempting to report the bug: ${error}`)
									}
								}
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("reporting bug", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "plan_mode_respond": {
						const response: string | undefined = block.params.response
						const optionsRaw: string | undefined = block.params.options
						const sharedMessage = {
							response: removeClosingTag("response", response),
							options: parsePartialArrayString(removeClosingTag("options", optionsRaw)),
						} satisfies ClinePlanModeResponse
						try {
							if (block.partial) {
								await this.ask("plan_mode_respond", JSON.stringify(sharedMessage), block.partial).catch(() => {})
								break
							} else {
								if (!response) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("plan_mode_respond", "response"))
									//
									break
								}
								this.consecutiveMistakeCount = 0

								// if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
								// 	showSystemNotification({
								// 		subtitle: "Cline has a response...",
								// 		message: response.replace(/\n/g, " "),
								// 	})
								// }

								// Store the number of options for telemetry
								const options = parsePartialArrayString(optionsRaw || "[]")

								this.isAwaitingPlanResponse = true
								let {
									text,
									images,
									files: planResponseFiles,
								} = await this.ask("plan_mode_respond", JSON.stringify(sharedMessage), false)
								this.isAwaitingPlanResponse = false

								// webview invoke sendMessage will send this marker in order to put webview into the proper state (responding to an ask) and as a flag to extension that the user switched to ACT mode.
								if (text === "PLAN_MODE_TOGGLE_RESPONSE") {
									text = ""
								}

								// Check if options contains the text response
								if (optionsRaw && text && parsePartialArrayString(optionsRaw).includes(text)) {
									// Valid option selected, don't show user message in UI
									// Update last followup message with selected option
									const lastPlanMessage = findLast(this.clineMessages, (m) => m.ask === "plan_mode_respond")
									if (lastPlanMessage) {
										lastPlanMessage.text = JSON.stringify({
											...sharedMessage,
											selected: text,
										} satisfies ClinePlanModeResponse)
										await this.saveClineMessagesAndUpdateHistory()
										telemetryService.captureOptionSelected(this.taskId, options.length, "plan")
									}
								} else {
									// Option not selected, send user feedback
									if (
										text ||
										(images && images.length > 0) ||
										(planResponseFiles && planResponseFiles.length > 0)
									) {
										telemetryService.captureOptionsIgnored(this.taskId, options.length, "plan")
										await this.say("user_feedback", text ?? "", images, planResponseFiles)
										await this.saveCheckpoint()
									}
								}

								let fileContentString = ""
								if (planResponseFiles && planResponseFiles.length > 0) {
									fileContentString = await processFilesIntoText(planResponseFiles)
								}

								if (this.didRespondToPlanAskBySwitchingMode) {
									pushToolResult(
										formatResponse.toolResult(
											`[The user has switched to ACT MODE, so you may now proceed with the task.]` +
												(text
													? `\n\nThe user also provided the following message when switching to ACT MODE:\n<user_message>\n${text}\n</user_message>`
													: ""),
											images,
											fileContentString,
										),
									)
								} else {
									// if we didn't switch to ACT MODE, then we can just send the user_feedback message
									pushToolResult(
										formatResponse.toolResult(
											`<user_message>\n${text}\n</user_message>`,
											images,
											fileContentString,
										),
									)
								}

								//
								break
							}
						} catch (error) {
							await handleError("responding to inquiry", error)
							//
							break
						}
					}
					case "load_mcp_documentation": {
						try {
							if (block.partial) {
								// shouldn't happen
								break
							} else {
								await this.say("load_mcp_documentation", "", undefined, undefined, false)
								pushToolResult(await loadMcpDocumentation(this.mcpHub))
								break
							}
						} catch (error) {
							await handleError("loading MCP documentation", error)
							break
						}
					}
					case "attempt_completion": {
						/*
						this.consecutiveMistakeCount = 0
						let resultToSend = result
						if (command) {
							await this.say("completion_result", resultToSend)
							// TODO: currently we don't handle if this command fails, it could be useful to let cline know and retry
							const [didUserReject, commandResult] = await this.executeCommand(command, true)
							// if we received non-empty string, the command was rejected or failed
							if (commandResult) {
								return [didUserReject, commandResult]
							}
							resultToSend = ""
						}
						const { response, text, images } = await this.ask("completion_result", resultToSend) // this prompts webview to show 'new task' button, and enable text input (which would be the 'text' here)
						if (response === "yesButtonClicked") {
							return [false, ""] // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
						}
						await this.say("user_feedback", text ?? "", images)
						return [
						*/
						const result: string | undefined = block.params.result
						const command: string | undefined = block.params.command

						const addNewChangesFlagToLastCompletionResultMessage = async () => {
							// Add newchanges flag if there are new changes to the workspace

							const hasNewChanges = await this.doesLatestTaskCompletionHaveNewChanges()
							const lastCompletionResultMessage = findLast(this.clineMessages, (m) => m.say === "completion_result")
							if (
								lastCompletionResultMessage &&
								hasNewChanges &&
								!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
							) {
								lastCompletionResultMessage.text += COMPLETION_RESULT_CHANGES_FLAG
							}
							await this.saveClineMessagesAndUpdateHistory()
						}

						try {
							const lastMessage = this.clineMessages.at(-1)
							if (block.partial) {
								if (command) {
									// the attempt_completion text is done, now we're getting command
									// remove the previous partial attempt_completion ask, replace with say, post state to webview, then stream command

									// const secondLastMessage = this.clineMessages.at(-2)
									// NOTE: we do not want to auto approve a command run as part of the attempt_completion tool
									if (lastMessage && lastMessage.ask === "command") {
										// update command
										await this.ask("command", removeClosingTag("command", command), block.partial).catch(
											() => {},
										)
									} else {
										// last message is completion_result
										// we have command string, which means we have the result as well, so finish it (doesn't have to exist yet)
										await this.say(
											"completion_result",
											removeClosingTag("result", result),
											undefined,
											undefined,
											false,
										)
										await this.saveCheckpoint(true)
										await addNewChangesFlagToLastCompletionResultMessage()
										await this.ask("command", removeClosingTag("command", command), block.partial).catch(
											() => {},
										)
									}
								} else {
									// no command, still outputting partial result
									await this.say(
										"completion_result",
										removeClosingTag("result", result),
										undefined,
										undefined,
										block.partial,
									)
								}
								break
							} else {
								if (!result) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("attempt_completion", "result"))
									break
								}
								this.consecutiveMistakeCount = 0

								if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
									showSystemNotification({
										subtitle: "Task Completed",
										message: result.replace(/\n/g, " "),
									})
								}

								let commandResult: ToolResponse | undefined
								if (command) {
									if (lastMessage && lastMessage.ask !== "command") {
										// haven't sent a command message yet so first send completion_result then command
										await this.say("completion_result", result, undefined, undefined, false)
										await this.saveCheckpoint(true)
										await addNewChangesFlagToLastCompletionResultMessage()
										telemetryService.captureTaskCompleted(this.taskId)
									} else {
										// we already sent a command message, meaning the complete completion message has also been sent
										await this.saveCheckpoint(true)
									}

									// complete command message
									const didApprove = await askApproval("command", command)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
									const [userRejected, execCommandResult] = await this.executeCommandTool(command!)
									if (userRejected) {
										this.didRejectTool = true
										pushToolResult(execCommandResult)
										await this.saveCheckpoint()
										break
									}
									// user didn't reject, but the command may have output
									commandResult = execCommandResult
								} else {
									await this.say("completion_result", result, undefined, undefined, false)
									await this.saveCheckpoint(true)
									await addNewChangesFlagToLastCompletionResultMessage()
									telemetryService.captureTaskCompleted(this.taskId)
								}

								// we already sent completion_result says, an empty string asks relinquishes control over button and field
								const {
									response,
									text,
									images,
									files: completionFiles,
								} = await this.ask("completion_result", "", false)
								if (response === "yesButtonClicked") {
									pushToolResult("") // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
									break
								}
								await this.say("user_feedback", text ?? "", images, completionFiles)
								await this.saveCheckpoint()

								const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
								if (commandResult) {
									if (typeof commandResult === "string") {
										toolResults.push({
											type: "text",
											text: commandResult,
										})
									} else if (Array.isArray(commandResult)) {
										toolResults.push(...commandResult)
									}
								}
								toolResults.push({
									type: "text",
									text: `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
								})
								toolResults.push(...formatResponse.imageBlocks(images))
								this.userMessageContent.push({
									type: "text",
									text: `${toolDescription()} Result:`,
								})
								this.userMessageContent.push(...toolResults)

								let fileContentString = ""
								if (completionFiles && completionFiles.length > 0) {
									fileContentString = await processFilesIntoText(completionFiles)
								}

								if (fileContentString) {
									this.userMessageContent.push({
										type: "text",
										text: fileContentString,
									})
								}

								//
								break
							}
						} catch (error) {
							await handleError("attempting completion", error)
							await this.saveCheckpoint()
							break
						}
					}
				}
				break
		}

		/*
		Seeing out of bounds is fine, it means that the next too call is being built up and ready to add to assistantMessageContent to present. 
		When you see the UI inactive during this, it means that a tool is breaking without presenting any UI. For example the write_to_file tool was breaking when relpath was undefined, and for invalid relpath it never presented UI.
		*/
		this.presentAssistantMessageLocked = false // this needs to be placed here, if not then calling this.presentAssistantMessage below would fail (sometimes) since it's locked
		// NOTE: when tool is rejected, iterator stream is interrupted and it waits for userMessageContentReady to be true. Future calls to present will skip execution since didRejectTool and iterate until contentIndex is set to message length and it sets userMessageContentReady to true itself (instead of preemptively doing it in iterator)
		if (!block.partial || this.didRejectTool || this.didAlreadyUseTool) {
			// block is finished streaming and executing
			if (this.currentStreamingContentIndex === this.assistantMessageContent.length - 1) {
				// its okay that we increment if !didCompleteReadingStream, it'll just return bc out of bounds and as streaming continues it will call presentAssistantMessage if a new block is ready. if streaming is finished then we set userMessageContentReady to true when out of bounds. This gracefully allows the stream to continue on and all potential content blocks be presented.
				// last block is complete and it is finished executing
				this.userMessageContentReady = true // will allow pwaitfor to continue
			}

			// call next block if it exists (if not then read stream will call it when its ready)
			this.currentStreamingContentIndex++ // need to increment regardless, so when read stream calls this function again it will be streaming the next block

			if (this.currentStreamingContentIndex < this.assistantMessageContent.length) {
				// there are already more content blocks to stream, so we'll call this function ourselves
				// await this.presentAssistantContent()

				this.presentAssistantMessage()
				return
			}
		}
		// block is partial, but the read stream may have finished
		if (this.presentAssistantMessageHasPendingUpdates) {
			this.presentAssistantMessage()
		}
	}

	async recursivelyMakeClineRequests(userContent: UserContent, includeFileDetails: boolean = false): Promise<boolean> {
		if (this.abort) {
			throw new Error("Cline instance aborted")
		}

		// Used to know what models were used in the task if user wants to export metadata for error reporting purposes
		const currentProviderId = (await getGlobalState(this.getContext(), "apiProvider")) as string
		if (currentProviderId && this.api.getModel().id) {
			try {
				await this.modelContextTracker.recordModelUsage(currentProviderId, this.api.getModel().id, this.chatSettings.mode)
			} catch {}
		}

		if (this.consecutiveMistakeCount >= 3) {
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
					: "Cline uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 3.7 Sonnet for its advanced agentic coding capabilities.",
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
			this.consecutiveMistakeCount = 0
		}

		if (
			this.autoApprovalSettings.enabled &&
			this.consecutiveAutoApprovedRequestsCount >= this.autoApprovalSettings.maxRequests
		) {
			if (this.autoApprovalSettings.enableNotifications) {
				showSystemNotification({
					subtitle: "Max Requests Reached",
					message: `Cline has auto-approved ${this.autoApprovalSettings.maxRequests.toString()} API requests.`,
				})
			}
			await this.ask(
				"auto_approval_max_req_reached",
				`Cline has auto-approved ${this.autoApprovalSettings.maxRequests.toString()} API requests. Would you like to reset the count and proceed with the task?`,
			)
			// if we get past the promise it means the user approved and did not start a new task
			this.consecutiveAutoApprovedRequestsCount = 0
		}

		// get previous api req's index to check token usage and determine if we need to truncate conversation history
		const previousApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")

		// Save checkpoint if this is the first API request
		const isFirstRequest = this.clineMessages.filter((m) => m.say === "api_req_started").length === 0

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		await this.say(
			"api_req_started",
			JSON.stringify({
				request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
			}),
		)

		// Initialize checkpoint tracker first if enabled and it's the first request
		if (isFirstRequest && this.enableCheckpoints && !this.checkpointTracker && !this.checkpointTrackerErrorMessage) {
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
				this.checkpointTrackerErrorMessage = errorMessage // will be displayed right away since we saveClineMessages next which posts state to webview
			}
		}

		// Now, if it's the first request AND checkpoints are enabled AND tracker was successfully initialized,
		// then say "checkpoint_created" and perform the commit.
		if (isFirstRequest && this.enableCheckpoints && this.checkpointTracker) {
			await this.say("checkpoint_created") // Now this is conditional
			const commitHash = await this.checkpointTracker.commit() // Actual commit
			const lastCheckpointMessage = findLast(this.clineMessages, (m) => m.say === "checkpoint_created")
			if (lastCheckpointMessage) {
				lastCheckpointMessage.lastCheckpointHash = commitHash
				// saveClineMessagesAndUpdateHistory will be called later after API response,
				// so no need to call it here unless this is the only modification to this message.
				// For now, assuming it's handled later.
			}
		} else if (isFirstRequest && this.enableCheckpoints && !this.checkpointTracker && this.checkpointTrackerErrorMessage) {
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

		await this.addToApiConversationHistory({
			role: "user",
			content: userContent,
		})

		telemetryService.captureConversationTurnEvent(this.taskId, currentProviderId, this.api.getModel().id, "user", true)

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")
		this.clineMessages[lastApiReqIndex].text = JSON.stringify({
			request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
		} satisfies ClineApiReqInfo)
		await this.saveClineMessagesAndUpdateHistory()
		await this.postStateToWebview()

		try {
			let cacheWriteTokens = 0
			let cacheReadTokens = 0
			let inputTokens = 0
			let outputTokens = 0
			let totalCost: number | undefined

			// update api_req_started. we can't use api_req_finished anymore since it's a unique case where it could come after a streaming message (ie in the middle of being updated or executed)
			// fortunately api_req_finished was always parsed out for the gui anyways, so it remains solely for legacy purposes to keep track of prices in tasks from history
			// (it's worth removing a few months from now)
			const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				const currentApiReqInfo: ClineApiReqInfo = JSON.parse(this.clineMessages[lastApiReqIndex].text || "{}")
				delete currentApiReqInfo.retryStatus // Clear retry status when request is finalized

				this.clineMessages[lastApiReqIndex].text = JSON.stringify({
					...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cacheWrites: cacheWriteTokens,
					cacheReads: cacheReadTokens,
					cost:
						totalCost ??
						calculateApiCostAnthropic(
							this.api.getModel().info,
							inputTokens,
							outputTokens,
							cacheWriteTokens,
							cacheReadTokens,
						),
					cancelReason,
					streamingFailedMessage,
				} satisfies ClineApiReqInfo)
			}

			const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				if (this.diffViewProvider.isEditing) {
					await this.diffViewProvider.revertChanges() // closes diff view
				}

				// if last message is a partial we need to update and save it
				const lastMessage = this.clineMessages.at(-1)
				if (lastMessage && lastMessage.partial) {
					// lastMessage.ts = Date.now() DO NOT update ts since it is used as a key for virtuoso list
					lastMessage.partial = false
					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					console.log("updating partial message", lastMessage)
					// await this.saveClineMessagesAndUpdateHistory()
				}

				// Let assistant know their response was interrupted for when task is resumed
				await this.addToApiConversationHistory({
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
				updateApiReqMsg(cancelReason, streamingFailedMessage)
				await this.saveClineMessagesAndUpdateHistory()

				telemetryService.captureConversationTurnEvent(
					this.taskId,
					currentProviderId,
					this.api.getModel().id,
					"assistant",
					true,
				)

				// signals to provider that it can retrieve the saved messages from disk, as abortTask can not be awaited on in nature
				this.didFinishAbortingStream = true
			}

			// reset streaming state
			this.currentStreamingContentIndex = 0
			this.assistantMessageContent = []
			this.didCompleteReadingStream = false
			this.userMessageContent = []
			this.userMessageContentReady = false
			this.didRejectTool = false
			this.didAlreadyUseTool = false
			this.presentAssistantMessageLocked = false
			this.presentAssistantMessageHasPendingUpdates = false
			this.didAutomaticallyRetryFailedApiRequest = false
			await this.diffViewProvider.reset()

			const stream = this.attemptApiRequest(previousApiReqIndex) // yields only if the first chunk is successful, otherwise will allow the user to retry the request (most likely due to rate limit error, which gets thrown on the first chunk)
			let assistantMessage = ""
			let reasoningMessage = ""
			this.isStreaming = true
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
							if (!this.abort) {
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
							const prevLength = this.assistantMessageContent.length
							const enableFunctionCallsParsing = await this.isClaude4ModelFamily()

							if (enableFunctionCallsParsing) {
								this.assistantMessageContent = parseAssistantMessageV3(assistantMessage)
							} else {
								this.assistantMessageContent = parseAssistantMessageV2(assistantMessage)
							}

							if (this.assistantMessageContent.length > prevLength) {
								this.userMessageContentReady = false // new content we need to present, reset to false in case previous content set this to true
							}
							// present content to user
							this.presentAssistantMessage()
							break
					}

					if (this.abort) {
						console.log("aborting stream...")
						if (!this.abandoned) {
							// only need to gracefully abort if this instance isn't abandoned (sometimes openrouter stream hangs, in which case this would affect future instances of cline)
							await abortStream("user_cancelled")
						}
						break // aborts the stream
					}

					if (this.didRejectTool) {
						// userContent has a tool rejection, so interrupt the assistant's response to present the user's feedback
						assistantMessage += "\n\n[Response interrupted by user feedback]"
						// this.userMessageContentReady = true // instead of setting this preemptively, we allow the present iterator to finish and set userMessageContentReady when its ready
						break
					}

					// PREV: we need to let the request finish for openrouter to get generation details
					// UPDATE: it's better UX to interrupt the request at the cost of the api cost not being retrieved
					if (this.didAlreadyUseTool) {
						assistantMessage +=
							"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
						break
					}
				}
			} catch (error) {
				// abandoned happens when extension is no longer waiting for the cline instance to finish aborting (error is thrown here when any function in the for loop throws due to this.abort)
				if (!this.abandoned) {
					this.abortTask() // if the stream failed, there's various states the task could be in (i.e. could have streamed some tools the user may have executed), so we just resort to replicating a cancel task
					const errorMessage = this.formatErrorWithStatusCode(error)

					await abortStream("streaming_failed", errorMessage)
					await this.reinitExistingTaskFromId(this.taskId)
				}
			} finally {
				this.isStreaming = false
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
					updateApiReqMsg()
					await this.saveClineMessagesAndUpdateHistory()
					await this.postStateToWebview()
				})
			}

			// need to call here in case the stream was aborted
			if (this.abort) {
				throw new Error("Cline instance aborted")
			}

			this.didCompleteReadingStream = true

			// set any blocks to be complete to allow presentAssistantMessage to finish and set userMessageContentReady to true
			// (could be a text block that had no subsequent tool uses, or a text block at the very end, or an invalid tool use, etc. whatever the case, presentAssistantMessage relies on these blocks either to be completed or the user to reject a block in order to proceed and eventually set userMessageContentReady to true)
			const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
			partialBlocks.forEach((block) => {
				block.partial = false
			})
			// this.assistantMessageContent.forEach((e) => (e.partial = false)) // can't just do this bc a tool could be in the middle of executing ()
			if (partialBlocks.length > 0) {
				this.presentAssistantMessage() // if there is content to update then it will complete and update this.userMessageContentReady to true, which we pwaitfor before making the next request. all this is really doing is presenting the last partial message that we just set to complete
			}

			updateApiReqMsg()
			await this.saveClineMessagesAndUpdateHistory()
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

				await this.addToApiConversationHistory({
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

				await pWaitFor(() => this.userMessageContentReady)

				// if the model did not tool use, then we need to tell it to either use a tool or attempt_completion
				const didToolUse = this.assistantMessageContent.some((block) => block.type === "tool_use")

				if (!didToolUse) {
					// normal request where tool use is required
					this.userMessageContent.push({
						type: "text",
						text: formatResponse.noToolsUsed(),
					})
					this.consecutiveMistakeCount++
				}

				const recDidEndLoop = await this.recursivelyMakeClineRequests(this.userMessageContent)
				didEndLoop = recDidEndLoop
			} else {
				// if there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				await this.say(
					"error",
					"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
				)
				await this.addToApiConversationHistory({
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

		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(this.getContext(), cwd)

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
								cwd,
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
			clinerulesError = await ensureLocalClineDirExists(cwd, GlobalFileNames.clineRules)
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
			.map((absolutePath) => path.relative(cwd, absolutePath))

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
			.map((absolutePath) => path.relative(cwd, absolutePath))

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

		if (busyTerminals.length > 0 && this.didEditFile) {
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
		this.didEditFile = false // reset, this lets us know when to wait for saved files to update terminals

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
			details += `\n\n# Current Working Directory (${cwd.toPosix()}) Files\n`
			const isDesktop = arePathsEqual(cwd, path.join(os.homedir(), "Desktop"))
			if (isDesktop) {
				// don't want to immediately access desktop since it would show permission popup
				details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
			} else {
				const [files, didHitLimit] = await listFiles(cwd, true, 200)
				const result = formatResponse.formatFilesList(cwd, files, didHitLimit, this.clineIgnoreController)
				details += result
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

		const modifiedMessages = combineApiRequests(combineCommandSequences(this.clineMessages.slice(1)))
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
