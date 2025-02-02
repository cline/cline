import { Anthropic } from "@anthropic-ai/sdk"
import cloneDeep from "clone-deep"
import delay from "delay"
import fs from "fs/promises"
import getFolderSize from "get-folder-size"
import os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { ApiHandler, buildApiHandler } from "../api"
import CheckpointTracker from "../integrations/checkpoints/CheckpointTracker"
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "../integrations/editor/DiffViewProvider"
import { findToolName, formatContentBlockToMarkdown } from "../integrations/misc/export-markdown"
import { extractTextFromFile } from "../integrations/misc/extract-text"
import { showSystemNotification } from "../integrations/notifications"
import { TerminalManager } from "../integrations/terminal/TerminalManager"
import { BrowserSession } from "../services/browser/BrowserSession"
import { UrlContentFetcher } from "../services/browser/UrlContentFetcher"
import { listFiles } from "../services/glob/list-files"
import { regexSearchFiles } from "../services/ripgrep"
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter"
import { ApiConfiguration } from "../shared/api"
import { findLast, findLastIndex } from "../shared/array"
import { AutoApprovalSettings } from "../shared/AutoApprovalSettings"
import { BrowserSettings } from "../shared/BrowserSettings"
import { ChatSettings } from "../shared/ChatSettings"
import { combineApiRequests } from "../shared/combineApiRequests"
import { combineCommandSequences, COMMAND_REQ_APP_STRING } from "../shared/combineCommandSequences"
import {
	BrowserAction,
	BrowserActionResult,
	browserActions,
	ClineApiReqCancelReason,
	ClineApiReqInfo,
	ClineAsk,
	ClineAskUseMcpServer,
	ClineMessage,
	ClineSay,
	ClineSayBrowserAction,
	ClineSayTool,
	COMPLETION_RESULT_CHANGES_FLAG,
} from "../shared/ExtensionMessage"
import { getApiMetrics } from "../shared/getApiMetrics"
import { HistoryItem } from "../shared/HistoryItem"
import { ClineAskResponse, ClineCheckpointRestore } from "../shared/WebviewMessage"
import { calculateApiCost } from "../utils/cost"
import { fileExistsAtPath } from "../utils/fs"
import { arePathsEqual, getReadablePath } from "../utils/path"
import { fixModelHtmlEscaping, removeInvalidChars } from "../utils/string"
import { AssistantMessageContent, parseAssistantMessage, ToolParamName, ToolUseName } from "./assistant-message"
import { constructNewFileContent } from "./assistant-message/diff"
import { parseMentions } from "./mentions"
import { formatResponse } from "./prompts/responses"
import { ClineProvider, GlobalFileNames } from "./webview/ClineProvider"
import { OpenRouterHandler } from "../api/providers/openrouter"
import { getNextTruncationRange, getTruncatedMessages } from "./sliding-window"
import { SYSTEM_PROMPT } from "./prompts/system"
import { addUserInstructions } from "./prompts/system"
import { OpenAiHandler } from "../api/providers/openai"
import { ApiStream } from "../api/transform/stream"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop") // may or may not exist but fs checking existence would immediately ask for permission which would be bad UX, need to come up with a better solution

type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>
type UserContent = Array<
	Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
>

/**
 * Cline 核心类，负责处理与 AI 的交互、工具使用、文件操作等核心功能
 *
 * 主要职责：
 * 1. 管理任务生命周期（创建、恢复、检查点等）
 * 2. 处理与 AI 的对话流
 * 3. 执行各种工具操作（文件读写、命令执行、浏览器操作等）
 * 4. 管理终端会话和浏览器会话
 * 5. 处理用户反馈和自动批准设置
 */
export class Cline {
	readonly taskId: string // 当前任务的唯一标识符
	api: ApiHandler // API 处理器，用于与 AI 模型交互
	private terminalManager: TerminalManager // 终端管理器，用于执行命令
	private urlContentFetcher: UrlContentFetcher // URL 内容获取器，用于获取网页内容
	browserSession: BrowserSession // 浏览器会话管理器，用于控制浏览器操作
	private didEditFile: boolean = false // 标记是否编辑过文件，用于判断是否需要等待终端更新
	customInstructions?: string // 用户自定义指令，用于定制 AI 行为
	autoApprovalSettings: AutoApprovalSettings // 自动批准设置，控制工具使用的自动批准行为
	private browserSettings: BrowserSettings // 浏览器设置，控制浏览器相关行为
	private chatSettings: ChatSettings // 聊天设置，控制聊天相关行为
	apiConversationHistory: Anthropic.MessageParam[] = [] // API 对话历史记录，保存与 AI 的对话
	clineMessages: ClineMessage[] = [] // Cline 消息记录，保存所有交互消息
	private askResponse?: ClineAskResponse // 用户响应，保存用户对询问的响应
	private askResponseText?: string // 用户响应文本，保存用户输入的文本
	private askResponseImages?: string[] // 用户响应图片，保存用户上传的图片
	private lastMessageTs?: number // 最后一条消息的时间戳，用于消息排序
	private consecutiveAutoApprovedRequestsCount: number = 0 // 连续自动批准请求计数，用于限制自动批准次数
	private consecutiveMistakeCount: number = 0 // 连续错误计数，用于检测和防止重复错误
	private providerRef: WeakRef<ClineProvider> // ClineProvider 的弱引用，用于访问 UI 相关功能
	private abort: boolean = false // 是否中止任务，用于控制任务终止
	didFinishAbortingStream = false // 是否完成中止流，用于判断流式处理是否完成中止
	abandoned = false // 是否被放弃，用于判断任务是否被用户放弃
	private diffViewProvider: DiffViewProvider // 差异视图提供者，用于显示文件差异
	private checkpointTracker?: CheckpointTracker // 检查点跟踪器，用于管理任务检查点
	checkpointTrackerErrorMessage?: string // 检查点错误信息，保存检查点相关错误
	conversationHistoryDeletedRange?: [number, number] // 对话历史删除范围，用于记录被删除的对话范围
	isInitialized = false // 是否已初始化，用于判断实例是否完成初始化
	isAwaitingPlanResponse = false // 是否等待计划响应，用于 PLAN MODE 下的状态管理
	didRespondToPlanAskBySwitchingMode = false // 是否通过切换模式响应计划询问，用于模式切换判断

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

	constructor(
		provider: ClineProvider,
		apiConfiguration: ApiConfiguration,
		autoApprovalSettings: AutoApprovalSettings,
		browserSettings: BrowserSettings,
		chatSettings: ChatSettings,
		customInstructions?: string,
		task?: string,
		images?: string[],
		historyItem?: HistoryItem,
	) {
		this.providerRef = new WeakRef(provider)
		this.api = buildApiHandler(apiConfiguration)
		this.terminalManager = new TerminalManager()
		this.urlContentFetcher = new UrlContentFetcher(provider.context)
		this.browserSession = new BrowserSession(provider.context, browserSettings)
		this.diffViewProvider = new DiffViewProvider(cwd)
		this.customInstructions = customInstructions
		this.autoApprovalSettings = autoApprovalSettings
		this.browserSettings = browserSettings
		this.chatSettings = chatSettings
		if (historyItem) {
			// 历史任务
			this.taskId = historyItem.id
			this.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
			this.resumeTaskFromHistory()
		} else if (task || images) {
			// 新建任务
			this.taskId = Date.now().toString()
			this.startTask(task, images)
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}
	}

	updateBrowserSettings(browserSettings: BrowserSettings) {
		this.browserSettings = browserSettings
		this.browserSession.browserSettings = browserSettings
	}

	updateChatSettings(chatSettings: ChatSettings) {
		this.chatSettings = chatSettings
	}

	// 将任务存储到磁盘以保存历史记录

	private async ensureTaskDirectoryExists(): Promise<string> {
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		const taskDir = path.join(globalStoragePath, "tasks", this.taskId)
		await fs.mkdir(taskDir, { recursive: true })
		return taskDir
	}

	private async getSavedApiConversationHistory(): Promise<Anthropic.MessageParam[]> {
		const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.apiConversationHistory)
		const fileExists = await fileExistsAtPath(filePath)
		if (fileExists) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		}
		return []
	}

	private async addToApiConversationHistory(message: Anthropic.MessageParam) {
		this.apiConversationHistory.push(message)
		await this.saveApiConversationHistory()
	}

	private async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]) {
		this.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	private async saveApiConversationHistory() {
		try {
			const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.apiConversationHistory)
			await fs.writeFile(filePath, JSON.stringify(this.apiConversationHistory))
		} catch (error) {
			// 如果失败，我们不想停止任务
			console.error("Failed to save API conversation history:", error)
		}
	}

	private async getSavedClineMessages(): Promise<ClineMessage[]> {
		const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.uiMessages)
		if (await fileExistsAtPath(filePath)) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		} else {
			// 检查旧位置
			const oldPath = path.join(await this.ensureTaskDirectoryExists(), "claude_messages.json")
			if (await fileExistsAtPath(oldPath)) {
				const data = JSON.parse(await fs.readFile(oldPath, "utf8"))
				await fs.unlink(oldPath) // remove old file
				return data
			}
		}
		return []
	}

	private async addToClineMessages(message: ClineMessage) {
		// these values allow us to reconstruct the conversation history at the time this cline message was created
		// it's important that apiConversationHistory is initialized before we add cline messages
		message.conversationHistoryIndex = this.apiConversationHistory.length - 1 // NOTE: this is the index of the last added message which is the user message, and once the clinemessages have been presented we update the apiconversationhistory with the completed assistant message. This means when reseting to a message, we need to +1 this index to get the correct assistant message that this tool use corresponds to
		message.conversationHistoryDeletedRange = this.conversationHistoryDeletedRange
		this.clineMessages.push(message)
		await this.saveClineMessages()
	}

	private async overwriteClineMessages(newMessages: ClineMessage[]) {
		this.clineMessages = newMessages
		await this.saveClineMessages()
	}
	/**
	 * 保存与任务相关的消息，并更新任务历史记录。
	 * 它首先尝试确保任务目录存在，然后将消息写入文件。
	 * 接着，它获取一些与 API 请求相关的指标，并找到最后一个相关的消息。还尝试获取任务目录的大小。
	 * 最后，它调用一个提供程序的方法来更新任务历史记录，如果出现错误则在控制台输出错误信息。
	 */
	private async saveClineMessages() {
		try {
			const taskDir = await this.ensureTaskDirectoryExists()
			const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
			await fs.writeFile(filePath, JSON.stringify(this.clineMessages))
			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.clineMessages.slice(1))))
			const taskMessage = this.clineMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.clineMessages[
					findLastIndex(this.clineMessages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))
				]
			let taskDirSize = 0
			try {
				// getFolderSize.loose silently ignores errors
				// returns # of bytes, size/1000/1000 = MB
				taskDirSize = await getFolderSize.loose(taskDir)
			} catch (error) {
				console.error("Failed to get task directory size:", taskDir, error)
			}
			await this.providerRef.deref()?.updateTaskHistory({
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
				conversationHistoryDeletedRange: this.conversationHistoryDeletedRange,
			})
		} catch (error) {
			console.error("Failed to save cline messages:", error)
		}
	}
	/**
	 * 根据给定的消息时间戳和恢复类型来恢复检查点，可能涉及任务、工作区或两者的恢复操作。具体步骤如下：
	 * 1.根据消息时间戳在clineMessages数组中查找对应消息，如果未找到则打印错误信息并返回。
	 * 2.根据不同的恢复类型进行操作：
		- 如果是 “task” 类型，则不进行工作区恢复相关操作。
		- 如果是 “taskAndWorkspace” 或 “workspace” 类型：
		- 尝试创建检查点跟踪器，如果创建失败则记录错误信息、向 Web 视图发送状态并显示错误消息。
		- 如果存在消息的最后检查点哈希值和检查点跟踪器，则尝试将检查点跟踪器的头部重置为该哈希值，失败则显示错误消息。
	 * 3.如果工作区恢复未失败：
		- 根据恢复类型进行不同的任务恢复操作，包括更新对话历史、覆盖clineMessages、发送关于已删除 API 请求的信息等。
		- 显示相应的恢复成功信息，并向 Web 视图发送消息，取消当前任务并重新初始化以获取更新后的消息。
	 * 4.如果工作区恢复失败，仅向 Web 视图发送消息。
	 * @param messageTs 消息序号
	 * @param restoreType 重置类型 "task" | "workspace" | "taskAndWorkspace"
	 * @returns 
	 */
	async restoreCheckpoint(messageTs: number, restoreType: ClineCheckpointRestore) {
		const messageIndex = this.clineMessages.findIndex((m) => m.ts === messageTs)
		const message = this.clineMessages[messageIndex]
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
				if (!this.checkpointTracker) {
					try {
						this.checkpointTracker = await CheckpointTracker.create(this.taskId, this.providerRef.deref())
						this.checkpointTrackerErrorMessage = undefined
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						console.error("Failed to initialize checkpoint tracker:", errorMessage)
						this.checkpointTrackerErrorMessage = errorMessage
						await this.providerRef.deref()?.postStateToWebview()
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
					) //+1因为这个索引对应于最后一个用户消息，另一个+1因为切片结束索引是独占的
					await this.overwriteApiConversationHistory(newConversationHistory)

					// 聚合已删除的api请求信息，这样我们就不会损失成本/代币
					const deletedMessages = this.clineMessages.slice(messageIndex + 1)
					const deletedApiReqsMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(deletedMessages)))

					const newClineMessages = this.clineMessages.slice(0, messageIndex + 1)
					await this.overwriteClineMessages(newClineMessages) // 调用保存历史记录的saveClineMessages

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

			await this.providerRef.deref()?.postMessageToWebview({ type: "relinquishControl" })

			this.providerRef.deref()?.cancelTask() // 该任务已被提供者预先取消，但我们需要重新初始化以获取更新的消息
		} else {
			await this.providerRef.deref()?.postMessageToWebview({ type: "relinquishControl" })
		}
	}

	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean) {
		const relinquishButton = () => {
			this.providerRef.deref()?.postMessageToWebview({ type: "relinquishControl" })
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

		// TODO: handle if this is called from outside original workspace, in which case we need to show user error message we cant show diff outside of workspace?
		if (!this.checkpointTracker) {
			try {
				this.checkpointTracker = await CheckpointTracker.create(this.taskId, this.providerRef.deref())
				this.checkpointTrackerErrorMessage = undefined
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				this.checkpointTrackerErrorMessage = errorMessage
				await this.providerRef.deref()?.postStateToWebview()
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
				const lastTaskCompletedMessage = findLast(
					this.clineMessages.slice(0, messageIndex),
					(m) => m.say === "completion_result",
				) // ask is only used to relinquish control, its the last say we care about
				// if undefined, then we get diff from beginning of git
				// if (!lastTaskCompletedMessage) {
				// 	console.error("No previous task completion message found")
				// 	return
				// }

				// Get changed files between current state and commit
				changedFiles = await this.checkpointTracker?.getDiffSet(
					lastTaskCompletedMessage?.lastCheckpointHash, // if undefined, then we get diff from beginning of git history, AKA when the task was started
					hash,
				)
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

		if (!this.checkpointTracker) {
			try {
				this.checkpointTracker = await CheckpointTracker.create(this.taskId, this.providerRef.deref())
				this.checkpointTrackerErrorMessage = undefined
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				return false
			}
		}

		// Get last task completed
		const lastTaskCompletedMessage = findLast(this.clineMessages.slice(0, messageIndex), (m) => m.say === "completion_result")

		try {
			// Get changed files between current state and commit
			const changedFiles = await this.checkpointTracker?.getDiffSet(
				lastTaskCompletedMessage?.lastCheckpointHash, // if undefined, then we get diff from beginning of git history, AKA when the task was started
				hash,
			)
			const changedFilesCount = changedFiles?.length || 0
			if (changedFilesCount > 0) {
				return true
			}
		} catch (error) {
			console.error("Failed to get diff set:", error)
			return false
		}

		return false
	}

	// 与 webview 通信

	// partial has three valid states true (partial message), false (completion of partial message), undefined (individual complete message)
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
	): Promise<{
		response: ClineAskResponse
		text?: string
		images?: string[]
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
					// 现有的部分消息，所以更新
					lastMessage.text = text
					lastMessage.partial = partial
					// todo 一次只保存和发布新数据或整条消息更有效率，因此忽略部分保存，并且只在新侦听器中发布部分消息而不是整个数组
					// await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef.deref()?.postMessageToWebview({
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
					await this.providerRef.deref()?.postStateToWebview()
					throw new Error("Current ask promise was ignored 2")
				}
			} else {
				// partial=false means its a complete version of a previously partial message
				if (isUpdatingPreviousPartial) {
					// this is the complete version of a previously partial message, so replace the partial with the complete version
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined

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
					await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef.deref()?.postMessageToWebview({
						type: "partialMessage",
						partialMessage: lastMessage,
					})
				} else {
					// this is a new partial=false message, so add it like normal
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
					})
					await this.providerRef.deref()?.postStateToWebview()
				}
			}
		} else {
			// this is a new non-partial message, so add it like normal
			// const lastMessage = this.clineMessages.at(-1)
			this.askResponse = undefined
			this.askResponseText = undefined
			this.askResponseImages = undefined
			askTs = Date.now()
			this.lastMessageTs = askTs
			await this.addToClineMessages({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
			})
			await this.providerRef.deref()?.postStateToWebview()
		}

		await pWaitFor(() => this.askResponse !== undefined || this.lastMessageTs !== askTs, { interval: 100 })
		if (this.lastMessageTs !== askTs) {
			throw new Error("Current ask promise was ignored") // could happen if we send multiple asks in a row i.e. with command_output. It's important that when we know an ask could fail, it is handled gracefully
		}
		const result = {
			response: this.askResponse!,
			text: this.askResponseText,
			images: this.askResponseImages,
		}
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined
		return result
	}

	async handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]) {
		this.askResponse = askResponse
		this.askResponseText = text
		this.askResponseImages = images
	}
	/**
	 *  用于处理消息的发送和更新。它根据传入的参数类型、文本内容、图片数组和是否为部分消息的标志，决定如何处理消息。
	 * 具体来说，它可以更新现有的部分消息，或者添加新的消息，并在适当的时候将这些消息发送到Web视图。
	 * @param type 表示消息的类型，是一个字符串，指示消息的具体类别。
	 * @param text 表示消息的文本内容，可以是任意字符串，可能为空。
	 * @param images 表示与消息关联的图片数组，可能是一个字符串数组，存储图片的 URL 或路径。
	 * @param partial 一个布尔值，指示消息是否为部分消息。如果为 true，则表示消息尚未完成；如果为 false，则表示消息是完整的。
	 */
	async say(type: ClineSay, text?: string, images?: string[], partial?: boolean): Promise<undefined> {
		if (this.abort) {
			throw new Error("Cline instance aborted")
		}

		if (partial !== undefined) {
			// 检查 partial 是否定义。如果定义，获取最后一条消息并检查它是否为部分消息，并且类型和内容与当前消息相同。
			const lastMessage = this.clineMessages.at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// 更新现有的部分消息
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = partial
					await this.providerRef.deref()?.postMessageToWebview({
						type: "partialMessage",
						partialMessage: lastMessage,
					})
				} else {
					// 添加新的部分消息
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						partial,
					})
					await this.providerRef.deref()?.postStateToWebview()
				}
			} else {
				// partial = false表示其以前部分消息的完整版本
				if (isUpdatingPreviousPartial) {
					// 替换为完整版本的部分消息
					this.lastMessageTs = lastMessage.ts
					// lastMessage.ts = sayTs
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = false

					// 我们没有流媒体事件，而是进行保存和发布，例如正常事件，以持续到磁盘
					await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef.deref()?.postMessageToWebview({
						type: "partialMessage",
						partialMessage: lastMessage,
					}) // 比整个PostateToweBview的性能更高
				} else {
					// 添加新的完整消息
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
					})
					await this.providerRef.deref()?.postStateToWebview()
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
			})
			await this.providerRef.deref()?.postStateToWebview()
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
			await this.saveClineMessages()
			await this.providerRef.deref()?.postStateToWebview()
		}
	}

	// 任务生命周期管理

	private async startTask(task?: string, images?: string[]): Promise<void> {
		// conversationHistory（对于 API）和 clineMessages（对于 webview）需要同步
		// 如果扩展进程被终止，那么在重新启动时 clineMessages 可能不为空，因此我们需要在创建新的
		// Cline 客户端时将其设置为 [] （否则 webview 将显示上一个会话的过时消息）
		this.clineMessages = []
		this.apiConversationHistory = []
		// 更新窗口消息
		await this.providerRef.deref()?.postStateToWebview()
		// 用于处理消息的发送和更新
		await this.say("text", task, images)

		this.isInitialized = true

		let imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)
		await this.initiateTaskLoop(
			[
				{
					type: "text",
					text: `<task>\n${task}\n</task>`,
				},
				...imageBlocks,
			],
			true,
		)
	}
	/**
	 * 尝试从历史记录中恢复一个任务，它涉及检查各种条件、处理历史消息、转换消息格式、处理工具使用情况以及最终发起任务循环。
	 * 1.首先检查旧任务的检查点是否存在，如果不存在则设置错误消息。
	 * 2.获取并修改保存的 Cline 消息，删除与恢复任务不相关的消息以及没有成本价值且没有取消理由的api_req_started消息。
	 * 3.向用户呈现 Cline 消息并询问是否恢复任务，根据最后一条 Cline 消息的类型确定询问类型。
	 * 4.如果用户响应为messageResponse，则发送用户反馈消息。
	 * 5.获取并转换 API 对话历史记录，将工具块转换为文本块，以确保模型不会对如何调用工具感到困惑。
	 * 6.检查最后一条消息是否为辅助消息，如果有工具使用，则为未完成的工具调用添加 “中断” 响应；如果没有工具使用，则不做特殊处理。如果最后一条消息是用户消息，检查前一条辅助消息是否有工具调用，如有未完成的工具调用，则在用户消息中添加 “中断” 响应。
	 * 7.根据最后一条 Cline 消息的时间和是否最近，生成新的用户内容，包括任务中断的时间信息、当前工作目录以及任务恢复的提示信息。如果有用户响应的文本和图像，也将其添加到新的用户内容中。
	 * 8.覆盖 API 对话历史记录并发起任务循环。
	 */
	private async resumeTaskFromHistory() {
		// TODO: 现在我们让用户为旧任务初始化检查点，假设他们从同一个工作区继续它们（我们从不将其绑定到任务，因此我们无法知道它是否在正确的工作区中打开）
		// const doesShadowGitExist = await CheckpointTracker.doesShadowGitExist(this.taskId, this.providerRef.deref())
		// if (!doesShadowGitExist) {
		// 	this.checkpointTrackerErrorMessage = "Checkpoints are only available for new tasks"
		// }

		const modifiedClineMessages = await this.getSavedClineMessages()

		// 删除之前可能添加的任何简历消息
		const lastRelevantMessageIndex = findLastIndex(
			modifiedClineMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)
		if (lastRelevantMessageIndex !== -1) {
			modifiedClineMessages.splice(lastRelevantMessageIndex + 1)
		}

		// 由于我们不再使用api_req_finished，我们需要检查最后一个api_req_started是否有成本价值，如果没有，并且没有取消理由，那么我们将其删除，因为它表示没有任何部分内容流式传输的api请求
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
		this.clineMessages = await this.getSavedClineMessages()

		//现在向用户呈现cline消息并询问他们是否想要恢复（注意：我们之前遇到过一个bug，在打开旧任务时apiconversationhistory不会被初始化，这是因为我们正在等待恢复）
		//如果用户在没有先恢复任务的情况下删除消息，这很重要
		this.apiConversationHistory = await this.getSavedApiConversationHistory()

		const lastClineMessage = this.clineMessages
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // 可能是多个简历任务
		// const lastClineMessage = this.clineMessages[lastClineMessageIndex]
		// could be a completion result with a command
		// const secondLastClineMessage = this.clineMessages
		// 	.slice()
		// 	.reverse()
		// 	.find(
		// 		(m, index) =>
		// 			index !== lastClineMessageIndex && !(m.ask === "resume_task" || m.ask === "resume_completed_task")
		// 	)
		// (lastClineMessage?.ask === "command" && secondLastClineMessage?.ask === "completion_result")

		let askType: ClineAsk
		if (lastClineMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else {
			askType = "resume_task"
		}

		this.isInitialized = true

		const { response, text, images } = await this.ask(askType) // calls poststatetowebview
		let responseText: string | undefined
		let responseImages: string[] | undefined
		if (response === "messageResponse") {
			await this.say("user_feedback", text, images)
			responseText = text
			responseImages = images
		}

		// 需要确保API对话历史记录可以由API恢复，即使它与Cline消息不同步

		let existingApiConversationHistory: Anthropic.Messages.MessageParam[] = await this.getSavedApiConversationHistory()

		// v2.0 XML标签重构警告：由于我们不再使用工具，因此我们需要用文本块替换所有工具块
		const conversationWithoutToolBlocks = existingApiConversationHistory.map((message) => {
			if (Array.isArray(message.content)) {
				const newContent = message.content.map((block) => {
					if (block.type === "tool_use") {
						// 重要的是我们将新工具架构格式转换为新工具架构格式，因此该模型不会对如何调用工具感到困惑
						const inputAsXml = Object.entries(block.input as Record<string, string>)
							.map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
							.join("\n")
						return {
							type: "text",
							text: `<${block.name}>\n${inputAsXml}\n</${block.name}>`,
						} as Anthropic.Messages.TextBlockParam
					} else if (block.type === "tool_result") {
						// 转换块。包含文本块数组，删除图像
						const contentAsTextBlocks = Array.isArray(block.content)
							? block.content.filter((item) => item.type === "text")
							: [{ type: "text", text: block.content }]
						const textContent = contentAsTextBlocks.map((item) => item.text).join("\n\n")
						const toolName = findToolName(block.tool_use_id, existingApiConversationHistory)
						return {
							type: "text",
							text: `[${toolName} Result]\n\n${textContent}`,
						} as Anthropic.Messages.TextBlockParam
					}
					return block
				})
				return { ...message, content: newContent }
			}
			return message
		})
		existingApiConversationHistory = conversationWithoutToolBlocks

		// FIXME: 完全移除工具使用块

		// 如果最后一条消息是辅助消息，我们需要检查是否有工具使用，因为每个工具使用都必须有工具响应
		// 如果没有工具使用并且只有一个文本块，那么我们可以只添加一条用户消息。
		// （请注意，这不再相关，因为我们使用自定义工具提示而不是工具使用块，但这是出于遗留目的，以防用户恢复旧任务)

		// 如果最后一条消息是用户消息，我们可能需要在它之前获取助手消息，看看它是否进行了工具调用，如果是，请将剩余的工具响应填写为“中断”

		let modifiedOldUserContent: UserContent // 如果它的用户消息是最后一条消息，或者最后一条（助理）消息之前的用户消息
		let modifiedApiConversationHistory: Anthropic.Messages.MessageParam[] // 需要删除最后一条用户消息以替换为新的修改后的用户消息
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]

			if (lastMessage.role === "assistant") {
				const content = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				const hasToolUse = content.some((block) => block.type === "tool_use")

				if (hasToolUse) {
					const toolUseBlocks = content.filter(
						(block) => block.type === "tool_use",
					) as Anthropic.Messages.ToolUseBlock[]
					const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
						type: "tool_result",
						tool_use_id: block.id,
						content: "Task was interrupted before this tool call could be completed.",
					}))
					modifiedApiConversationHistory = [...existingApiConversationHistory] // no changes
					modifiedOldUserContent = [...toolResponses]
				} else {
					modifiedApiConversationHistory = [...existingApiConversationHistory]
					modifiedOldUserContent = []
				}
			} else if (lastMessage.role === "user") {
				const previousAssistantMessage: Anthropic.Messages.MessageParam | undefined =
					existingApiConversationHistory[existingApiConversationHistory.length - 2]

				const existingUserContent: UserContent = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
					const assistantContent = Array.isArray(previousAssistantMessage.content)
						? previousAssistantMessage.content
						: [
								{
									type: "text",
									text: previousAssistantMessage.content,
								},
							]

					const toolUseBlocks = assistantContent.filter(
						(block) => block.type === "tool_use",
					) as Anthropic.Messages.ToolUseBlock[]

					if (toolUseBlocks.length > 0) {
						const existingToolResults = existingUserContent.filter(
							(block) => block.type === "tool_result",
						) as Anthropic.ToolResultBlockParam[]

						const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
							.filter((toolUse) => !existingToolResults.some((result) => result.tool_use_id === toolUse.id))
							.map((toolUse) => ({
								type: "tool_result",
								tool_use_id: toolUse.id,
								content: "Task was interrupted before this tool call could be completed.",
							}))

						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1) // removes the last user message
						modifiedOldUserContent = [...existingUserContent, ...missingToolResponses]
					} else {
						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
						modifiedOldUserContent = [...existingUserContent]
					}
				} else {
					modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
					modifiedOldUserContent = [...existingUserContent]
				}
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			throw new Error("Unexpected: No existing API conversation history")
			// console.error("Unexpected: No existing API conversation history")
			// modifiedApiConversationHistory = []
			// modifiedOldUserContent = []
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

		newUserContent.push({
			type: "text",
			text:
				`[TASK RESUMPTION] ${
					this.chatSettings?.mode === "plan"
						? `This task was interrupted ${agoText}. The conversation may have been incomplete. Be aware that the project state may have changed since then. The current working directory is now '${cwd.toPosix()}'.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful. However you are in PLAN MODE, so rather than continuing the task, you must respond to the user's message.`
						: `This task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '${cwd.toPosix()}'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.`
				}${
					wasRecent
						? "\n\nIMPORTANT: If the last tool use was a replace_in_file or write_to_file that was interrupted, the file was reverted back to its original state before the interrupted edit, and you do NOT need to re-read the file as you already have its up-to-date contents."
						: ""
				}` +
				(responseText
					? `\n\n${this.chatSettings?.mode === "plan" ? "New message to respond to with plan_mode_response tool (be sure to provide your response in the <response> parameter)" : "New instructions for task continuation"}:\n<user_message>\n${responseText}\n</user_message>`
					: this.chatSettings.mode === "plan"
						? "(The user did not provide a new message. Consider asking them how they'd like you to proceed, or to switch to Act mode to continue with the task.)"
						: ""),
		})

		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...formatResponse.imageBlocks(responseImages))
		}

		await this.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.initiateTaskLoop(newUserContent, false)
	}
	/**
	 * 该函数负责启动一个任务循环，持续调用递归请求，直到任务完成或用户中止。
	 * 循环中首次请求时会包含文件详情，后续请求则不再包含。若在循环中未调用完成尝试，
	 * 系统将强制继续任务，直到达到最大请求次数或用户确认任务完成。
	 *
	 * @param userContent 用户上下文信息
	 * @param isNewTask  是否是新任务
	 */
	private async initiateTaskLoop(userContent: UserContent, isNewTask: boolean): Promise<void> {
		let nextUserContent = userContent
		let includeFileDetails = true
		while (!this.abort) {
			// 处理一系列与某个任务相关的操作，包括处理错误情况、显示系统通知、加载上下文信息、发送 API 请求、处理流数据等。
			// 函数中包含了多个条件判断和异常处理逻辑，以确保任务的稳定执行和状态更新。
			const didEndLoop = await this.recursivelyMakeClineRequests(nextUserContent, includeFileDetails, isNewTask)
			includeFileDetails = false // 首次请求时会包含文件详情

			//  这个代理循环的工作方式是 cline 将获得一个任务，然后他调用工具来完成该任务。
			// 除非有attempt_completion呼叫，否则我们会一直用他的工具的响应来回复他，直到他attempt_completion或不再使用工具。
			// 如果他不再使用工具，我们会让他考虑一下他是否完成了任务，然后打电话给attempt_completion，否则继续完成任务。
			// 有一个MAX_REQUESTS_PER_TASK限制来防止无限请求，但系统会提示 Cline 尽可能高效地完成任务。

			//const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didEndLoop) {
				// 目前，任务永远不会 “完成”。仅当用户达到最大请求数并拒绝重置计数时，才会发生这种情况。
				// this.say("task_completed", `Task completed. Total API usage cost: ${totalCost}`)
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
		this.browserSession.closeBrowser()
		await this.diffViewProvider.revertChanges() // need to await for when we want to make sure directories/files are reverted before re-starting the task from a checkpoint
	}

	// 保存当前任务状态为检查点
	async saveCheckpoint() {
		const commitHash = await this.checkpointTracker?.commit() // silently fails for now
		if (commitHash) {
			// 从最后开始，向后工作，直到我们找到工具用途或另一条带有哈希的消息
			for (let i = this.clineMessages.length - 1; i >= 0; i--) {
				const message = this.clineMessages[i]
				if (message.lastCheckpointHash) {
					// Found a message with a hash, so we can stop
					break
				}
				// Update this message with a hash
				message.lastCheckpointHash = commitHash

				// 我们只关心将哈希添加到最后一次工具使用中（我们不想将此哈希添加到每个先前的消息中，即任务预检查点）
				const isToolUse =
					message.say === "tool" ||
					message.ask === "tool" ||
					message.say === "command" ||
					message.ask === "command" ||
					message.say === "completion_result" ||
					message.ask === "completion_result" ||
					message.ask === "followup" ||
					message.say === "use_mcp_server" ||
					message.ask === "use_mcp_server" ||
					message.say === "browser_action" ||
					message.say === "browser_action_launch" ||
					message.ask === "browser_action_launch"

				if (isToolUse) {
					break
				}
			}
			// 保存更新的消息
			await this.saveClineMessages()
		}
	}

	// 执行命令行工具

	async executeCommandTool(command: string): Promise<[boolean, ToolResponse]> {
		const terminalInfo = await this.terminalManager.getOrCreateTerminal(cwd)
		terminalInfo.terminal.show() // 创建新的终端（甚至手动）时，顶部有一个空白空间，奇怪的视觉bug。
		const process = this.terminalManager.runCommand(terminalInfo, command)

		let userFeedback: { text?: string; images?: string[] } | undefined
		let didContinue = false
		const sendCommandOutput = async (line: string): Promise<void> => {
			try {
				const { response, text, images } = await this.ask("command_output", line)
				if (response === "yesButtonClicked") {
					// proceed while running
				} else {
					userFeedback = { text, images }
				}
				didContinue = true
				process.continue() //继续等待
			} catch {
				// 这只有在忽略这个求婚的情况下才会发生，因此请忽略此错误
			}
		}

		let result = ""
		process.on("line", (line) => {
			result += line + "\n"
			if (!didContinue) {
				sendCommandOutput(line)
			} else {
				this.say("command_output", line)
			}
		})

		let completed = false
		process.once("completed", () => {
			completed = true
		})

		process.once("no_shell_integration", async () => {
			await this.say("shell_integration_warning")
		})

		await process

		// 等待短暂延迟以确保将所有消息发送到WebView
		// 这种延迟允许创建未熟悉的承诺的时间，并
		// 要将其关联的消息发送到WebView，请维护
		// 消息的正确顺序（尽管WebView很明智
		// 分组命令_OUTPUT消息，尽管有任何差距）
		await delay(50)

		result = result.trim()

		if (userFeedback) {
			await this.say("user_feedback", userFeedback.text, userFeedback.images)
			return [
				true,
				formatResponse.toolResult(
					`Command is still running in the user's terminal.${
						result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
					}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
					userFeedback.images,
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

	shouldAutoApproveTool(toolName: ToolUseName): boolean {
		if (this.autoApprovalSettings.enabled) {
			switch (toolName) {
				case "read_file":
				case "list_files":
				case "list_code_definition_names":
				case "search_files":
					return this.autoApprovalSettings.actions.readFiles
				case "write_to_file":
				case "replace_in_file":
					return this.autoApprovalSettings.actions.editFiles
				case "execute_command":
					return this.autoApprovalSettings.actions.executeCommands
				case "browser_action":
					return this.autoApprovalSettings.actions.useBrowser
				case "access_mcp_resource":
				case "use_mcp_tool":
					return this.autoApprovalSettings.actions.useMcp
			}
		}
		return false
	}

	/**
	 * 尝试进行 API 请求。函数等待 MCP 服务器连接后生成系统提示符，根据不同情况处理系统提示，判断是否接近上下文窗口限制并进行相应处理，最后创建消息流并处理可能出现的错误，
	 * 返回消息流的内容。具体功能包括：
	 * 1.等待 MCP 服务器连接，若超时则报错。
	 * 2.检查 MCP 中心是否可用，若不可用则报错。
	 * 3.生成系统提示，结合自定义指令和特定规则文件指令对系统提示进行调整。
	 * 4.如果上一个 API 请求的总令牌使用量接近上下文窗口，截断对话历史以释放空间。
	 * 5.创建 API 请求的消息流，尝试获取第一个消息块，若出现错误根据情况进行重试或询问用户是否重试。若第一个消息块获取成功，则继续生成并返回剩余的消息块。
	 * @param previousApiReqIndex 上一个 API 请求的索引
	 * @returns 返回一个异步生成器，用于处理 API 流
	 */
	async *attemptApiRequest(previousApiReqIndex: number): ApiStream {
		// 等待 MCP 服务器连接后再生成系统提示符
		await pWaitFor(() => this.providerRef.deref()?.mcpHub?.isConnecting !== true, { timeout: 10_000 }).catch(() => {
			console.error("MCP servers failed to connect in time")
		})

		const mcpHub = this.providerRef.deref()?.mcpHub
		if (!mcpHub) {
			throw new Error("MCP hub not available")
		}

		let systemPrompt = await SYSTEM_PROMPT(
			cwd,
			this.api.getModel().info.supportsComputerUse ?? false,
			mcpHub,
			this.browserSettings,
		)

		let settingsCustomInstructions = this.customInstructions?.trim()
		const clineRulesFilePath = path.resolve(cwd, GlobalFileNames.clineRules)
		let clineRulesFileInstructions: string | undefined
		if (await fileExistsAtPath(clineRulesFilePath)) {
			try {
				const ruleFileContent = (await fs.readFile(clineRulesFilePath, "utf8")).trim()
				if (ruleFileContent) {
					clineRulesFileInstructions = `# .clinerules\n\nThe following is provided by a root-level .clinerules file where the user has specified instructions for this working directory (${cwd.toPosix()})\n\n${ruleFileContent}`
				}
			} catch {
				console.error(`Failed to read .clinerules file at ${clineRulesFilePath}`)
			}
		}

		if (settingsCustomInstructions || clineRulesFileInstructions) {
			// 更改系统提示中任务将打破提示缓存，但是在大计划中，这不会经常更改，因此最好不要按照我们必须使用<潜在相关细节>的方式来污染用户消息。
			systemPrompt += addUserInstructions(settingsCustomInstructions, clineRulesFileInstructions)
		}

		// 如果以前的API请求的总代币使用靠近上下文窗口，请截断对话历史记录以释放新请求的空间
		if (previousApiReqIndex >= 0) {
			const previousRequest = this.clineMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				let contextWindow = this.api.getModel().info.contextWindow || 128_000
				// FIXME：hack让任何使用OpenAI与DeepSeek兼容的人具有适当的上下文窗口，而不是默认的128K。我们需要用户来指定通过OpenAI兼容输入的模型的上下文窗口
				if (this.api instanceof OpenAiHandler && this.api.getModel().id.toLowerCase().includes("deepseek")) {
					contextWindow = 64_000
				}
				let maxAllowedSize: number
				switch (contextWindow) {
					case 64_000: // deepseek models
						maxAllowedSize = contextWindow - 27_000
						break
					case 128_000: // most models
						maxAllowedSize = contextWindow - 30_000
						break
					case 200_000: // claude models
						maxAllowedSize = contextWindow - 40_000
						break
					default:
						maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
				}

				// 这是我们接近访问上下文窗口时最可靠的方式。
				if (totalTokens >= maxAllowedSize) {
					// NOTE: 没关系，我们overwriteConversationHistory恢复任务，因为我们只删除最后一条用户消息，而不是中间任何会影响这个范围的内容
					this.conversationHistoryDeletedRange = getNextTruncationRange(
						this.apiConversationHistory,
						this.conversationHistoryDeletedRange,
					)
					await this.saveClineMessages() // 保存任务历史项，我们用它来跟踪对话历史中已删除的范围。
					// await this.overwriteApiConversationHistory(truncatedMessages)
				}
			}
		}

		// 仅当我们接近击中上下文窗口时，就会更新ConsectHistoryDe​​letrange，因此我们不会不断打破提示缓存
		const truncatedConversationHistory = getTruncatedMessages(
			this.apiConversationHistory,
			this.conversationHistoryDeletedRange,
		)

		let stream = this.api.createMessage(systemPrompt, truncatedConversationHistory)

		const iterator = stream[Symbol.asyncIterator]()

		try {
			// awaiting first chunk to see if it will throw an error
			// 等待第一个块，看看它是否会抛出错误
			this.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			yield firstChunk.value
			this.isWaitingForFirstChunk = false
		} catch (error) {
			const isOpenRouter = this.api instanceof OpenRouterHandler
			if (isOpenRouter && !this.didAutomaticallyRetryFailedApiRequest) {
				console.log("first chunk failed, waiting 1 second before retrying")
				await delay(1000)
				this.didAutomaticallyRetryFailedApiRequest = true
			} else {
				// request failed after retrying automatically once, ask user if they want to retry again
				// 自动重试一次后请求失败，询问用户是否要重试一次
				// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.
				// 请注意，这个api_req_failed询问是独一无二的，因为我们只在api还没有流式传输任何内容时才提供这个选项（即它在第一个到期块上失败），因为它允许他们点击重试按钮。然而，如果api在中途失败，它可能处于某些工具可能已经执行的任何任意状态，因此错误处理方式不同，需要完全取消任务。
				const { response } = await this.ask(
					"api_req_failed",
					error.message ?? JSON.stringify(serializeError(error), null, 2),
				)
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

	/**
	 * 展示助手消息
	 * 处理从 AI 接收到的消息，包括文本内容和工具调用
	 */
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
			// 如果最后一个内容块在流传输完成之前完成，则可能会发生这种情况。如果流式传输完成，并且我们超出范围，则这意味着我们已经呈现/执行了最后一个内容块，并准备好继续下一个请求
			if (this.didCompleteReadingStream) {
				this.userMessageContentReady = true
			}
			// console.log("no more content blocks to stream! this shouldn't happen?")
			this.presentAssistantMessageLocked = false
			return
			//throw new Error("No more content blocks to stream! This shouldn't happen...") // remove and just return after testing
		}

		const block = cloneDeep(this.assistantMessageContent[this.currentStreamingContentIndex]) // 需要在流中更新数组时创建复制BC，它也可以更新参考块属性
		switch (block.type) {
			case "text": {
				if (this.didRejectTool || this.didAlreadyUseTool) {
					break
				}
				let content = block.content
				if (content) {
					// (have to do this for partial and complete since sending content in thinking tags to markdown renderer will automatically be removed
					// 必须部分和完整地这样做，因为将思维标签中的内容发送到降价渲染器将自动删除)
					// Remove end substrings of <thinking or </thinking (below xml parsing is only for opening tags)
					// (这是通过下面的xml解析完成的，但保留在这里以供参考)
					// content = content.replace(/<\/?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?$/, "")
					// Remove all instances of <thinking> (with optional line break after) and </thinking> (with optional line break before)
					// - 需要分开，因为我们不想删除第一个标签之前的换行符
					// - 需要在下面的xml解析之前发生
					content = content.replace(/<thinking>\s?/g, "")
					content = content.replace(/\s?<\/thinking>/g, "")

					// 删除内容末尾的部分XML标记（用于工具使用和思考标记）
					// (防止自动删除标签时scrollview跳转)
					const lastOpenBracketIndex = content.lastIndexOf("<")
					if (lastOpenBracketIndex !== -1) {
						const possibleTag = content.slice(lastOpenBracketIndex)
						// 检查最后一个'<'之后是否有一个'>'（即，如果标签完成）（目前将删除完整的思考和工具标签）
						const hasCloseBracket = possibleTag.includes(">")
						if (!hasCloseBracket) {
							// 提取潜在标签名称
							let tagContent: string
							if (possibleTag.startsWith("</")) {
								tagContent = possibleTag.slice(2).trim()
							} else {
								tagContent = possibleTag.slice(1).trim()
							}
							// 检查TagContent是否可能是不完整的标签名称（仅字母和下划线）
							const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)
							// 抢先删除<或</以防止这些工件出现在聊天中（也处理关闭思考标签）
							const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"
							// 如果标签不完整并且最后，请将其从内容中删除
							if (isOpeningOrClosing || isLikelyTagName) {
								content = content.slice(0, lastOpenBracketIndex).trim()
							}
						}
					}
				}

				if (!block.partial) {
					// Some models add code block artifacts (around the tool calls) which show up at the end of text content
					// 一些模型添加代码块工件（围绕工具调用），这些工件显示在文本内容的末尾
					// matches ``` with atleast one char after the last backtick, at the end of the string
					const match = content?.trimEnd().match(/```[a-zA-Z0-9_-]+$/)
					if (match) {
						const matchLength = match[0].length
						content = content.trimEnd().slice(0, -matchLength)
					}
				}

				await this.say("text", content, undefined, block.partial)
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
						case "plan_mode_response":
							return `[${block.name}]`
						case "attempt_completion":
							return `[${block.name}]`
					}
				}

				if (this.didRejectTool) {
					// 用户一次拒绝工具后，忽略任何工具内容
					if (!block.partial) {
						this.userMessageContent.push({
							type: "text",
							text: `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`,
						})
					} else {
						// 用户拒绝以前的工具后的部分工具
						this.userMessageContent.push({
							type: "text",
							text: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`,
						})
					}
					break
				}

				if (this.didAlreadyUseTool) {
					// 使用工具后忽略任何内容
					this.userMessageContent.push({
						type: "text",
						text: `Tool [${block.name}] was not executed because a tool has already been used in this message. Only one tool may be used per message. You must assess the first tool's result before proceeding to use the next tool.`,
					})
					break
				}

				const pushToolResult = (content: ToolResponse) => {
					this.userMessageContent.push({
						type: "text",
						text: `${toolDescription()} Result:`,
					})
					if (typeof content === "string") {
						this.userMessageContent.push({
							type: "text",
							text: content || "(tool did not return anything)",
						})
					} else {
						this.userMessageContent.push(...content)
					}
					// 一旦收集了工具结果，请忽略所有其他工具的使用，因为我们应该只在每条消息中呈现一个工具结果
					this.didAlreadyUseTool = true
				}

				const askApproval = async (type: ClineAsk, partialMessage?: string) => {
					const { response, text, images } = await this.ask(type, partialMessage, false)
					if (response !== "yesButtonClicked") {
						if (response === "messageResponse") {
							await this.say("user_feedback", text, images)
							pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images))
							// this.userMessageContent.push({
							// 	type: "text",
							// 	text: `${toolDescription()}`,
							// })
							// this.toolResults.push({
							// 	type: "tool_result",
							// 	tool_use_id: toolUseId,
							// 	content: this.formatToolResponseWithImages(
							// 		await this.formatToolDeniedFeedback(text),
							// 		images
							// 	),
							// })
							this.didRejectTool = true
							return false
						}
						pushToolResult(formatResponse.toolDenied())
						// this.toolResults.push({
						// 	type: "tool_result",
						// 	tool_use_id: toolUseId,
						// 	content: await this.formatToolDenied(),
						// })
						this.didRejectTool = true
						return false
					}
					return true
				}

				const showNotificationForApprovalIfAutoApprovalEnabled = (message: string) => {
					if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
						showSystemNotification({
							subtitle: "Approval Required",
							message,
						})
					}
				}

				const handleError = async (action: string, error: Error) => {
					if (this.abandoned) {
						console.log("Ignoring error since task was abandoned (i.e. from task cancellation after resetting)")
						return
					}
					const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
					await this.say(
						"error",
						`Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`,
					)
					// this.toolResults.push({
					// 	type: "tool_result",
					// 	tool_use_id: toolUseId,
					// 	content: await this.formatToolError(errorString),
					// })
					pushToolResult(formatResponse.toolError(errorString))
				}

				// 如果块是部分的，则删除部分结束标签，这样它就不会呈现给用户
				const removeClosingTag = (tag: ToolParamName, text?: string) => {
					if (!block.partial) {
						return text || ""
					}
					if (!text) {
						return ""
					}
					// 此正则是动态构建一个模式以匹配关闭标签：
					//  -可选地匹配标签之前的空格
					//  -匹配'<'或'</'，可选地随后是标签名称中的任何子集
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
					case "write_to_file":
					case "replace_in_file": {
						const relPath: string | undefined = block.params.path
						let content: string | undefined = block.params.content // for write_to_file
						let diff: string | undefined = block.params.diff // for replace_in_file
						if (!relPath || (!content && !diff)) {
							// 检查内容/diff确保Relath完成
							// 等待，以便我们可以确定是新文件还是编辑现有文件
							break
						}
						// 使用缓存映射或 fs.access 检查文件是否存在
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
							if (diff) {
								if (!this.api.getModel().id.includes("claude")) {
									// deepseek models tend to use unescaped html entities in diffs
									diff = fixModelHtmlEscaping(diff)
									diff = removeInvalidChars(diff)
								}
								try {
									newContent = await constructNewFileContent(
										diff,
										this.diffViewProvider.originalContent || "",
										!block.partial,
									)
								} catch (error) {
									await this.say("diff_error", relPath)
									pushToolResult(
										formatResponse.toolError(
											`${(error as Error)?.message}\n\n` +
												`This is likely because the SEARCH block content doesn't match exactly with what's in the file, or if you used multiple SEARCH/REPLACE blocks they may not have been in the order they appear in the file.\n\n` +
												`The file was reverted to its original state:\n\n` +
												`<file_content path="${relPath.toPosix()}">\n${this.diffViewProvider.originalContent}\n</file_content>\n\n` +
												`Try again with a more precise SEARCH block.\n(If you keep running into this error, you may use the write_to_file tool as a workaround.)`,
										),
									)
									await this.diffViewProvider.revertChanges()
									await this.diffViewProvider.reset()
									break
								}
							} else if (content) {
								newContent = content

								//预处理新内容，以应对较弱模型可能添加 Markdown 代码块标记 (deepseek/llama) 或额外转义字符 (gemini) 等工件的情况
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

							newContent = newContent.trimEnd() // 删除任何尾随换行符，因为它是由编辑器自动插入的

							const sharedMessageProps: ClineSayTool = {
								tool: fileExists ? "editedExistingFile" : "newFileCreated",
								path: getReadablePath(cwd, removeClosingTag("path", relPath)),
								content: diff || content,
							}

							if (block.partial) {
								// update gui message
								const partialMessage = JSON.stringify(sharedMessageProps)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool") // 如果用户中途更改自动批准设置
									await this.say("tool", partialMessage, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									await this.ask("tool", partialMessage, block.partial).catch(() => {})
								}
								// 更新编辑器
								if (!this.diffViewProvider.isEditing) {
									//打开编辑器并准备在其中流式传输内容
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
								this.consecutiveMistakeCount = 0

								// 如果isEditingFile为false，则表示我们已经拥有文件的完整内容。
								// 注意这个函数是如何工作的是很重要的，你不能假设块。部分条件将始终被调用，因为它可能会立即获得完整的非部分数据。所以这部分逻辑将始终被调用。
								// 换句话说，您必须始终在此处重复block.部分逻辑
								if (!this.diffViewProvider.isEditing) {
									// 在显示编辑动画之前显示gui消息
									const partialMessage = JSON.stringify(sharedMessageProps)
									await this.ask("tool", partialMessage, true).catch(() => {}) // 为部分发送true，即使它不是部分，这会显示内容流式传输到编辑器之前的编辑行
									await this.diffViewProvider.open(relPath)
								}
								await this.diffViewProvider.update(newContent, true)
								await delay(300) // wait for diff view to update
								this.diffViewProvider.scrollToFirstDiff()
								// showOmissionWarning(this.diffViewProvider.originalContent || "", newContent)

								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: diff || content,
									// ? formatResponse.createPrettyPatch(
									// 		relPath,
									// 		this.diffViewProvider.originalContent,
									// 		newContent,
									// 	)
									// : undefined,
								} satisfies ClineSayTool)

								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++

									// 我们需要人为延迟，让诊断赶上变化
									await delay(3_500)
								} else {
									// 如果启用了自动批准但此工具未自动批准，请发送通知
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									// const didApprove = await askApproval("tool", completeMessage)

									// 需要一个更自定义的工具响应来进行文件编辑，以强调未更新文件的事实（对于DeepSeek尤其重要）
									let didApprove = true
									const { response, text, images } = await this.ask("tool", completeMessage, false)
									if (response !== "yesButtonClicked") {
										// TODO：为其他工具拒绝响应添加类似的上下文，以强调未运行命令
										const fileDeniedNote = fileExists
											? "The file was not updated, and maintains its original contents."
											: "The file was not created."
										if (response === "messageResponse") {
											await this.say("user_feedback", text, images)
											pushToolResult(
												formatResponse.toolResult(
													`The user denied this operation. ${fileDeniedNote}\nThe user provided the following feedback:\n<feedback>\n${text}\n</feedback>`,
													images,
												),
											)
											this.didRejectTool = true
											didApprove = false
										} else {
											pushToolResult(`The user denied this operation. ${fileDeniedNote}`)
											this.didRejectTool = true
											didApprove = false
										}
									}

									if (!didApprove) {
										await this.diffViewProvider.revertChanges()
										await this.saveCheckpoint()
										break
									}
								}

								const { newProblemsMessage, userEdits, autoFormattingEdits, finalContent } =
									await this.diffViewProvider.saveChanges()
								this.didEditFile = true // 用于确定我们是否应该等待繁忙的终端在发送API请求之前进行更新
								if (userEdits) {
									await this.say(
										"user_feedback_diff",
										JSON.stringify({
											tool: fileExists ? "editedExistingFile" : "newFileCreated",
											path: getReadablePath(cwd, relPath),
											diff: userEdits,
										} satisfies ClineSayTool),
									)
									pushToolResult(
										`The user made the following updates to your content:\n\n${userEdits}\n\n` +
											(autoFormattingEdits
												? `The user's editor also applied the following auto-formatting to your content:\n\n${autoFormattingEdits}\n\n(Note: Pay close attention to changes such as single quotes being converted to double quotes, semicolons being removed or added, long lines being broken into multiple lines, adjusting indentation style, adding/removing trailing commas, etc. This will help you ensure future SEARCH/REPLACE operations to this file are accurate.)\n\n`
												: "") +
											`The updated content, which includes both your original modifications and the additional edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file that was saved:\n\n` +
											`<final_file_content path="${relPath.toPosix()}">\n${finalContent}\n</final_file_content>\n\n` +
											`Please note:\n` +
											`1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
											`2. Proceed with the task using this updated file content as the new baseline.\n` +
											`3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
											`4. IMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference. This content reflects the current state of the file, including both user edits and any auto-formatting (e.g., if you used single quotes but the formatter converted them to double quotes). Always base your SEARCH/REPLACE operations on this final version to ensure accuracy.\n` +
											`${newProblemsMessage}`,
									)
								} else {
									pushToolResult(
										`The content was successfully saved to ${relPath.toPosix()}.\n\n` +
											(autoFormattingEdits
												? `Along with your edits, the user's editor applied the following auto-formatting to your content:\n\n${autoFormattingEdits}\n\n(Note: Pay close attention to changes such as single quotes being converted to double quotes, semicolons being removed or added, long lines being broken into multiple lines, adjusting indentation style, adding/removing trailing commas, etc. This will help you ensure future SEARCH/REPLACE operations to this file are accurate.)\n\n`
												: "") +
											`Here is the full, updated content of the file that was saved:\n\n` +
											`<final_file_content path="${relPath.toPosix()}">\n${finalContent}\n</final_file_content>\n\n` +
											`IMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference. This content reflects the current state of the file, including any auto-formatting (e.g., if you used single quotes but the formatter converted them to double quotes). Always base your SEARCH/REPLACE operations on this final version to ensure accuracy.\n\n` +
											`${newProblemsMessage}`,
									)
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
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, block.partial)
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
								this.consecutiveMistakeCount = 0
								const absolutePath = path.resolve(cwd, relPath)
								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: absolutePath,
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, false) // 需要发送partalValue bool，因为undefined有它自己的目的，因为消息既不被视为部分也不被视为部分的完成，而是被视为单个完整的消息
									this.consecutiveAutoApprovedRequestsCount++
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to read ${path.basename(absolutePath)}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
								}
								// 现在像往常一样执行工具
								const content = await extractTextFromFile(absolutePath)
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
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, block.partial)
								} else {
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									await this.ask("tool", partialMessage, block.partial).catch(() => {})
								}
								break
							} else {
								if (!relDirPath) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("list_files", "path"))
									await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0
								const absolutePath = path.resolve(cwd, relDirPath)
								const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)
								const result = formatResponse.formatFilesList(absolutePath, files, didHitLimit)
								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: result,
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to view directory ${path.basename(absolutePath)}/`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
								}
								pushToolResult(result)
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("listing files", error)
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
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, block.partial)
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
								const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)
								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: result,
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to view source code definitions in ${path.basename(absolutePath)}/`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
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
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", partialMessage, undefined, block.partial)
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
								const results = await regexSearchFiles(cwd, absolutePath, regex, filePattern)
								const completeMessage = JSON.stringify({
									...sharedMessageProps,
									content: results,
								} satisfies ClineSayTool)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool")
									await this.say("tool", completeMessage, undefined, false)
									this.consecutiveAutoApprovedRequestsCount++
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to search files in ${path.basename(absolutePath)}/`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										await this.saveCheckpoint()
										break
									}
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
										await this.say("browser_action_launch", url, undefined, false)
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

								await this.saveCheckpoint()
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
						const command: string | undefined = block.params.command
						const requiresApprovalRaw: string | undefined = block.params.requires_approval
						const requiresApproval = requiresApprovalRaw?.toLowerCase() === "true"

						try {
							if (block.partial) {
								if (this.shouldAutoApproveTool(block.name)) {
									// since depending on an upcoming parameter, requiresApproval this may become an ask - we cant partially stream a say prematurely. So in this particular case we have to wait for the requiresApproval parameter to be completed before presenting it.
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

								let didAutoApprove = false

								if (!requiresApproval && this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "command")
									await this.say("command", command, undefined, false)
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
											`${this.shouldAutoApproveTool(block.name) && requiresApproval ? COMMAND_REQ_APP_STRING : ""}`, // ugly hack until we refactor combineCommandSequences
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
									await this.say("use_mcp_server", partialMessage, undefined, block.partial)
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

								const isToolAutoApproved = this.providerRef
									.deref()
									?.mcpHub?.connections?.find((conn) => conn.server.name === server_name)
									?.server.tools?.find((tool) => tool.name === tool_name)?.autoApprove

								if (this.shouldAutoApproveTool(block.name) && isToolAutoApproved) {
									this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
									await this.say("use_mcp_server", completeMessage, undefined, false)
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
								const toolResult = await this.providerRef
									.deref()
									?.mcpHub?.callTool(server_name, tool_name, parsedArguments)

								// TODO: add progress indicator and ability to parse images and non-text responses
								const toolResultPretty =
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
								await this.say("mcp_server_response", toolResultPretty)
								pushToolResult(formatResponse.toolResult(toolResultPretty))
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
									await this.say("use_mcp_server", partialMessage, undefined, block.partial)
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
									await this.say("use_mcp_server", completeMessage, undefined, false)
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
								const resourceResult = await this.providerRef.deref()?.mcpHub?.readResource(server_name, uri)
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
						try {
							if (block.partial) {
								await this.ask("followup", removeClosingTag("question", question), block.partial).catch(() => {})
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

								const { text, images } = await this.ask("followup", question, false)
								await this.say("user_feedback", text ?? "", images)
								pushToolResult(formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images))
								await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("asking question", error)
							await this.saveCheckpoint()
							break
						}
					}
					case "plan_mode_response": {
						const response: string | undefined = block.params.response
						try {
							if (block.partial) {
								await this.ask("plan_mode_response", removeClosingTag("response", response), block.partial).catch(
									() => {},
								)
								break
							} else {
								if (!response) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("plan_mode_response", "response"))
									// await this.saveCheckpoint()
									break
								}
								this.consecutiveMistakeCount = 0

								// if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
								// 	showSystemNotification({
								// 		subtitle: "Cline has a response...",
								// 		message: response.replace(/\n/g, " "),
								// 	})
								// }

								this.isAwaitingPlanResponse = true
								const { text, images } = await this.ask("plan_mode_response", response, false)
								this.isAwaitingPlanResponse = false

								if (this.didRespondToPlanAskBySwitchingMode) {
									// await this.say("user_feedback", text ?? "", images)
									pushToolResult(
										formatResponse.toolResult(
											`[The user has switched to ACT MODE, so you may now proceed with the task.]`,
											images,
										),
									)
								} else {
									await this.say("user_feedback", text ?? "", images)
									pushToolResult(formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images))
								}

								// await this.saveCheckpoint()
								break
							}
						} catch (error) {
							await handleError("responding to inquiry", error)
							// await this.saveCheckpoint()
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
							await this.saveClineMessages()
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
										// we have command string, which means we have the result as well, so finish it (doesnt have to exist yet)
										await this.say("completion_result", removeClosingTag("result", result), undefined, false)
										await this.saveCheckpoint()
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
										block.partial,
									)
								}
								break
							} else {
								if (!result) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("attempt_completion", "result"))
									await this.saveCheckpoint()
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
										// havent sent a command message yet so first send completion_result then command
										await this.say("completion_result", result, undefined, false)
										await this.saveCheckpoint()
										await addNewChangesFlagToLastCompletionResultMessage()
									} else {
										// we already sent a command message, meaning the complete completion message has also been sent
										await this.saveCheckpoint()
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
									await this.say("completion_result", result, undefined, false)
									await this.saveCheckpoint()
									await addNewChangesFlagToLastCompletionResultMessage()
								}

								// we already sent completion_result says, an empty string asks relinquishes control over button and field
								const { response, text, images } = await this.ask("completion_result", "", false)
								if (response === "yesButtonClicked") {
									pushToolResult("") // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
									break
								}
								await this.say("user_feedback", text ?? "", images)

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

								// await this.saveCheckpoint()
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
		看到越界很好，这意味着下一个Too调用正在构建中，并准备添加到assistantMessageContent中。 
		当您在此期间看到UI处于非活动状态时，这意味着一个工具正在中断而没有显示任何UI。例如，当relpath未定义时，
		write_to_file工具正在中断，对于无效的relpath，它从未显示UI。
*/
		this.presentAssistantMessageLocked = false // 这需要放在这里，如果不是，那么调用这个。下面的presentAssistantMessage会失败（有时），因为它被锁定了
		//注意：当工具被拒绝时，迭代器流被中断，它等待userMessageContentReady为真。未来对现在的调用将跳过didRejectTool之后的执行并迭代，直到contentIndex设置为消息长度，它将userMessageContentReady设置为真（而不是在迭代器中抢先执行）
		if (!block.partial || this.didRejectTool || this.didAlreadyUseTool) {
			// 块已完成流式传输和执行
			if (this.currentStreamingContentIndex === this.assistantMessageContent.length - 1) {
				// 如果“!didCompleteReadingStream”为真，我们进行递增是可以的，它只会因为超出边界而返回，并且随着流的继续，如果有新的数据块准备好，它将调用“presentAssitantMessage”。
				// 如果流已完成，那么当超出边界时，我们将“userMessageContentReady”设置为真。这样可以优雅地让流继续下去，并呈现所有潜在的数据块。
				// 最后一个块完成并完成执行
				this.userMessageContentReady = true //将允许Pwaitfor继续
			}

			// 如果下一个块存在，则调用它（如果不存在，则读取流将在准备好时调用它）
			this.currentStreamingContentIndex++ // 无论如何都需要递增，因此当读取流再次调用此函数时，它将流式传输下一个块

			if (this.currentStreamingContentIndex < this.assistantMessageContent.length) {
				// 已经有更多的内容块要流式传输，所以我们将自己调用这个函数
				// await this.presentAssistantContent()

				this.presentAssistantMessage()
				return
			}
		}
		// 块是部分的，但读取流可能已经完成
		if (this.presentAssistantMessageHasPendingUpdates) {
			this.presentAssistantMessage()
		}
	}

	/**
	 * 递归处理 Cline 请求
	 * 1.判断模型错误次数是否大于等于 3 次，如果是，则提示用户，并且如果自动审批设置启用且通知开启，会展示系统通知，然后询问用户是否继续任务，并根据用户的响应更新用户内容和重置错误计数。
	 * 2.判断自动审批请求次数是否已满，如果是，则通知用户，并询问用户是否重置计数并继续任务，同时重置连续自动审批请求计数。
	 * 3.获取先前 API 请求的索引以检查令牌使用情况并确定是否需要截断对话历史记录。
	 * 4.初始化检查点追踪器（如果尚未初始化且是新任务），并处理可能出现的错误。
	 * 5.加载上下文信息，包括用户内容的解析和环境细节的获取，并将环境细节添加到用户内容中。
	 * 6.将更新后的用户内容添加到 API 对话历史记录中，更新占位符消息的文本，保存 Cline 消息并将状态发送到 WebView
	 * 7.定义用于更新 API 请求消息内容和处理流中止的函数
	 * 8.重置流的状态，包括各种标志和工具相关的状态，以及重置差异视图提供程序。
	 * 9.尝试进行 API 请求并处理流数据，包括更新令牌计数、解析助手消息、处理用户中断等情况。如果流出现错误，会中止任务并更新消息状态。
	 * 10.完成流的读取后，处理部分消息块，更新 API 请求消息内容，保存 Cline 消息并将状态发送到 WebView。
	 * 11.如果有助手消息，则将其添加到 API 对话历史记录中，等待用户消息内容准备好。如果模型没有使用工具，则向用户消息内容中添加提示信息并增加错误计数，然后递归调用自身。
	 * 如果没有助手消息，则记录错误并添加失败消息到对话历史记录。
	 * 12.捕获错误，如果发生错误则返回 true，以通知父循环结束任务。
	 *  @param userContent 用户内容
	 * @param includeFileDetails 是否包含文件详情
	 * @param isNewTask 是否是新任务
	 * @returns 返回是否结束循环
	 */
	async recursivelyMakeClineRequests(
		userContent: UserContent,
		includeFileDetails: boolean = false,
		isNewTask: boolean = false,
	): Promise<boolean> {
		if (this.abort) {
			throw new Error("Cline instance aborted")
		}
		// 累计遇到三次及以上的错误，提示用户
		if (this.consecutiveMistakeCount >= 3) {
			if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
				showSystemNotification({
					subtitle: "Error",
					message: "Cline is having trouble. Would you like to continue the task?",
				})
			}
			const { response, text, images } = await this.ask(
				"mistake_limit_reached",
				this.api.getModel().id.includes("claude")
					? `This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
					: "Cline uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 3.5 Sonnet for its advanced agentic coding capabilities.",
			)
			if (response === "messageResponse") {
				userContent.push(
					...[
						{
							type: "text",
							text: formatResponse.tooManyMistakes(text),
						} as Anthropic.Messages.TextBlockParam,
						...formatResponse.imageBlocks(images),
					],
				)
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
			// 如果我们超过了 Promise，则意味着用户批准了新任务，但没有启动新任务
			this.consecutiveAutoApprovedRequestsCount = 0
		}

		// 获取先前 API Req 的索引以检查令牌使用情况并确定是否需要截断对话历史记录
		const previousApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")

		//获取详细细节是一项昂贵的操作，它使用 globby 自上而下构建项目的文件结构，对于大型项目，可能需要几秒钟
		//为了获得最佳用户体验，我们会在发生这种情况时显示带有 loading Spinner 的占位符 api_req_started 消息
		await this.say(
			"api_req_started",
			JSON.stringify({
				request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
			}),
		)

		// 利用这个机会初始化 Checkpoint Tracker（在构造函数中初始化可能很昂贵）
		// FIXME：现在我们允许用户为旧任务初始化检查点，但如果在错误的工作区中打开任务，这可能是个问题
		// isNewTask & &
		if (!this.checkpointTracker) {
			try {
				this.checkpointTracker = await CheckpointTracker.create(this.taskId, this.providerRef.deref())
				this.checkpointTrackerErrorMessage = undefined
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				this.checkpointTrackerErrorMessage = errorMessage // 将立即显示，因为我们接下来保存了 ClineMessages 哪些帖子状态到 webview
			}
		}
		// 加载上下文信息
		const [parsedUserContent, environmentDetails] = await this.loadContext(userContent, includeFileDetails)
		userContent = parsedUserContent
		// 将环境详细信息添加为其自己的文本块，与工具结果分开
		userContent.push({ type: "text", text: environmentDetails })

		await this.addToApiConversationHistory({
			role: "user",
			content: userContent,
		})

		// 由于我们在等待实际启动 API 请求（例如加载潜在详细信息）时发送了一条占位符api_req_started消息来更新 WebView，
		// 因此我们需要更新该消息的文本
		const lastApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")
		this.clineMessages[lastApiReqIndex].text = JSON.stringify({
			request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
		} satisfies ClineApiReqInfo)
		await this.saveClineMessages()
		await this.providerRef.deref()?.postStateToWebview()

		try {
			let cacheWriteTokens = 0
			let cacheReadTokens = 0
			let inputTokens = 0
			let outputTokens = 0
			let totalCost: number | undefined

			//用于更新某个 API 请求的消息内容。该函数接受两个可选参数：cancelReason 和 streamingFailedMessage。
			// 函数的主要功能是修改 this.clineMessages 数组中最后一个 API 请求的文本内容，将其更新为一个包含多个信息的 JSON 字符串。
			// 更新api_req_started。我们不能再使用 api_req_finished，因为这是一种独特的情况，
			// 它可能出现在流式消息之后（即在更新或执行过程中）
			// 幸运的是，无论如何，api_req_finished 总是被解析为 GUI，因此它仅用于遗留目的，以跟踪 Tasks from History 中的价格
			// （从现在开始几个月后删除是值得的）
			const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				this.clineMessages[lastApiReqIndex].text = JSON.stringify({
					...JSON.parse(this.clineMessages[lastApiReqIndex].text || "{}"),
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cacheWrites: cacheWriteTokens,
					cacheReads: cacheReadTokens,
					cost:
						totalCost ??
						calculateApiCost(this.api.getModel().info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
					cancelReason,
					streamingFailedMessage,
				} satisfies ClineApiReqInfo)
			}
			// 用于处理流的中止操作。它主要的功能是在中止流时进行一些清理和状态更新，包括保存消息、更新状态以及记录中止原因。
			const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				if (this.diffViewProvider.isEditing) {
					await this.diffViewProvider.revertChanges() // closes diff view
				}

				// 如果最后一条消息是部分消息，我们需要更新并保存它
				const lastMessage = this.clineMessages.at(-1)
				if (lastMessage && lastMessage.partial) {
					// lastMessage.ts = Date.now（） 不要更新 ts，因为它被用作 virtuoso list 的键
					lastMessage.partial = false
					// 我们不是流式传输 partialMessage 事件，而是像往常一样执行 save 和 post 以持久化到磁盘
					console.log("updating partial message", lastMessage)
					// await this.saveClineMessages()
				}

				// 让助理知道他们的响应在任务恢复时被打断
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

				// 将 api_req_started 更新为 Cancelled 和 Cost，以便我们可以显示部分流的 cost
				updateApiReqMsg(cancelReason, streamingFailedMessage)
				await this.saveClineMessages()

				// 向 provider 发出信号，表明它可以从磁盘检索保存的消息，因为 abortTask 本质上不能等待
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

			// 处理一个从API请求返回的流数据，实时更新助手的消息并管理流的状态。
			// 具体来说，它主要处理来自API的不同类型的chunk（数据块），并根据这些数据块更新内部状态和用户界面。
			const stream = this.attemptApiRequest(previousApiReqIndex) // 仅当第一个 chunk 成功时才产生，否则将允许用户重试请求（很可能是由于速率限制错误，该错误在第一个 chunk 上抛出）
			let assistantMessage = ""
			this.isStreaming = true
			try {
				for await (const chunk of stream) {
					switch (chunk.type) {
						case "usage":
							inputTokens += chunk.inputTokens
							outputTokens += chunk.outputTokens
							cacheWriteTokens += chunk.cacheWriteTokens ?? 0
							cacheReadTokens += chunk.cacheReadTokens ?? 0
							totalCost = chunk.totalCost
							break
						case "text":
							assistantMessage += chunk.text
							// 将原始助理消息解析为内容块
							const prevLength = this.assistantMessageContent.length
							this.assistantMessageContent = parseAssistantMessage(assistantMessage)
							if (this.assistantMessageContent.length > prevLength) {
								this.userMessageContentReady = false // 我们需要提出的新内容，重置为false，以防以前的内容将其设置为true
							}
							// 向用户展示内容
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
						// userContent 有工具拒绝，因此中断助手的响应以呈现用户的反馈
						assistantMessage += "\n\n[Response interrupted by user feedback]"
						// this.userMessageContentReady = true //我们不是预先设置它，而是允许当前迭代器完成并在准备好时设置 userMessageContentReady
						break
					}

					// 下一条：我们需要让openrouter完成请求才能获取生成详细信息
					// 更新：最好的用户体验是中断请求，但代价是 api 成本未被检索
					if (this.didAlreadyUseTool) {
						assistantMessage +=
							"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
						break
					}
				}
			} catch (error) {
				// 当扩展名不再等待cline实例完成中止时，就会放弃（当此引起的任何功能抛出时，在此处丢弃错误）
				if (!this.abandoned) {
					this.abortTask() // if the stream failed, there's various states the task could be in (i.e. could have streamed some tools the user may have executed), so we just resort to replicating a cancel task
					await abortStream("streaming_failed", error.message ?? JSON.stringify(serializeError(error), null, 2))
					const history = await this.providerRef.deref()?.getTaskWithId(this.taskId)
					if (history) {
						await this.providerRef.deref()?.initClineWithHistoryItem(history.historyItem)
						// await this.providerRef.deref()?.postStateToWebview()
					}
				}
			} finally {
				this.isStreaming = false
			}

			// need to call here in case the stream was aborted
			if (this.abort) {
				throw new Error("Cline instance aborted")
			}

			this.didCompleteReadingStream = true

			// 设置要完成的任何块，以允许PresentAssIsTantMessage完成并将UsermessageContentReady设置为true
			// （可能是一个文本块，没有后续工具使用，也可能是末端的文本块，或无效的工具使用等。无论如何，PresentAssIsTantMessage都依赖于这些块要完成，或者用户拒绝块为了进行并最终将UsermessageContentReady设置为真）
			const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
			partialBlocks.forEach((block) => {
				block.partial = false
			})
			// this.assistantMessageContent.forEach((e) => (e.partial = false)) //不能这样做，因为工具可能正在执行 ()
			if (partialBlocks.length > 0) {
				this.presentAssistantMessage() // 如果有内容要更新，那么它将完成并将 this.userMessageContentReady 更新为 true，我们在发出下一个请求之前等待。这一切实际上是呈现我们刚刚设置完成的最后部分消息
			}

			updateApiReqMsg()
			await this.saveClineMessages()
			await this.providerRef.deref()?.postStateToWebview()

			// now add to apiconversationhistory
			// 需要在继续使用工具之前保存助手响应以归档，因为用户可以随时退出，我们将无法保存助手的响应
			let didEndLoop = false
			if (assistantMessage.length > 0) {
				await this.addToApiConversationHistory({
					role: "assistant",
					content: [{ type: "text", text: assistantMessage }],
				})

				//注意：这条评论是为了将来参考——这是一个解决userMessageContent没有设置为true的方法。这是因为它在didRejectTool时没有递归调用部分块，所以它会卡在等待部分块完成后才能继续。
				//以防内容块完成
				//它可能是api流在最后一个解析的内容块被执行后完成的，所以我们能够检测出界并将userMessageContentReady设置为true（注意你不应该调用presentAssistantMessage因为如果最后一个块完成，它将被再次呈现）
				// const completeBlocks = this.assistantMessageContent.filter((block) => !block.partial) // 如果流结束后有任何部分块，我们可以认为它们无效
				// if (this.currentStreamingContentIndex >= completeBlocks.length) {
				// 	this.userMessageContentReady = true
				// }

				await pWaitFor(() => this.userMessageContentReady)

				// if the model did not tool use, then we need to tell it to either use a tool or attempt_completion
				// 如果模型没有使用工具，那么我们需要告诉它要么使用工具，要么attempt_completion
				const didToolUse = this.assistantMessageContent.some((block) => block.type === "tool_use")

				if (!didToolUse) {
					// 需要使用工具的正常请求
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

	/**
	 * 加载上下文信息
	 * @param userContent 用户内容
	 * @param includeFileDetails 是否包含文件详情
	 * @returns 返回处理后的用户内容和环境详情
	 */
	async loadContext(userContent: UserContent, includeFileDetails: boolean = false) {
		return await Promise.all([
			// 这是从工具结果中动态加载上下文提及的临时解决方案。
			// 它会检查是否存在指示工具被拒绝并提供反馈的标签
			// （参见 formatToolDeniedFeedback、attemptCompletion、executeCommand 和 consecutiveMistakeCount >= 3）
			//  或 “<answer>”（参见 askFollowupQuestion），我们将所有用户生成的内容放在这些标签中，
			// 以便它们可以有效地用作何时应该解析提及的标记）。但是，如果我们将来允许多个工具响应，
			// 我们将需要专门解析用户内容标签中的提及。
			//  （注意：这会导致 @/ import 别名错误，其中文件内容也被解析，因为 v2 将工具结果转换为文本块）
			Promise.all(
				userContent.map(async (block) => {
					if (block.type === "text") {
						// 我们需要确保任何用户生成的内容都包含在其中一个标签中，以便我们知道要解析提及
						// FIXME：仅解析这些标签之间的文本，而不是可能包含其他工具结果的整个文本块。这是一个更大问题的一部分，
						// 我们首先不应该使用 regex 来解析提及（即对于文件路径有空格的情况）
						if (
							block.text.includes("<feedback>") ||
							block.text.includes("<answer>") ||
							block.text.includes("<task>") ||
							block.text.includes("<user_message>")
						) {
							return {
								...block,
								text: await parseMentions(block.text, cwd, this.urlContentFetcher),
							}
						}
					}
					return block
				}),
			),
			this.getEnvironmentDetails(includeFileDetails),
		])
	}

	/**
	 * 获取环境详情
	 * @param includeFileDetails 是否包含文件详情
	 * @returns 返回格式化的环境详情字符串
	 */
	async getEnvironmentDetails(includeFileDetails: boolean = false) {
		let details = ""

		// cline 知道用户在消息之间是否从一个文件转到另一个文件可能很有用，因此我们始终包含此上下文
		details += "\n\n# VSCode Visible Files"
		const visibleFiles = vscode.window.visibleTextEditors
			?.map((editor) => editor.document?.uri?.fsPath)
			.filter(Boolean)
			.map((absolutePath) => path.relative(cwd, absolutePath).toPosix())
			.join("\n")
		if (visibleFiles) {
			details += `\n${visibleFiles}`
		} else {
			details += "\n(No visible files)"
		}

		details += "\n\n# VSCode Open Tabs"
		const openTabs = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
			.filter(Boolean)
			.map((absolutePath) => path.relative(cwd, absolutePath).toPosix())
			.join("\n")
		if (openTabs) {
			details += `\n${openTabs}`
		} else {
			details += "\n(No open tabs)"
		}

		const busyTerminals = this.terminalManager.getTerminals(true)
		const inactiveTerminals = this.terminalManager.getTerminals(false)
		// const allTerminals = [...busyTerminals, ...inactiveTerminals]

		if (busyTerminals.length > 0 && this.didEditFile) {
			//  || this.didEditFile
			await delay(300) // delay after saving file to let terminals catch up
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
				const result = formatResponse.formatFilesList(cwd, files, didHitLimit)
				details += result
			}
		}

		details += "\n\n# Current Mode"
		if (this.chatSettings.mode === "plan") {
			details += "\nPLAN MODE"
			details +=
				"\nIn this mode you should focus on information gathering, asking questions, and architecting a solution. Once you have a plan, use the plan_mode_response tool to engage in a conversational back and forth with the user. Do not use the plan_mode_response tool until you've gathered all the information you need e.g. with read_file or ask_followup_question."
			details +=
				'\n(Remember: If it seems the user wants you to use tools only available in Act Mode, you should ask the user to "toggle to Act mode" (use those words) - they will have to manually do this themselves with the Plan/Act toggle button below. You do not have the ability to switch to Act Mode yourself, and must wait for the user to do it themselves once they are satisfied with the plan.)'
		} else {
			details += "\nACT MODE"
		}

		return `<environment_details>\n${details.trim()}\n</environment_details>`
	}
}
