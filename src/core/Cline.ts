import * as path from "path"
import os from "os"
import crypto from "crypto"
import EventEmitter from "events"

import { Anthropic } from "@anthropic-ai/sdk"
import cloneDeep from "clone-deep"
import delay from "delay"
import pWaitFor from "p-wait-for"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"

// schemas
import { TokenUsage, ToolUsage, ToolName } from "../schemas"

// api
import { ApiHandler, buildApiHandler } from "../api"
import { ApiStream } from "../api/transform/stream"

// shared
import { ApiConfiguration } from "../shared/api"
import { findLastIndex } from "../shared/array"
import { combineApiRequests } from "../shared/combineApiRequests"
import { combineCommandSequences } from "../shared/combineCommandSequences"
import {
	ClineApiReqCancelReason,
	ClineApiReqInfo,
	ClineAsk,
	ClineMessage,
	ClineSay,
	ToolProgressStatus,
} from "../shared/ExtensionMessage"
import { getApiMetrics } from "../shared/getApiMetrics"
import { HistoryItem } from "../shared/HistoryItem"
import { ClineAskResponse } from "../shared/WebviewMessage"
import { defaultModeSlug, getModeBySlug } from "../shared/modes"
import { ToolParamName, ToolResponse, DiffStrategy } from "../shared/tools"

// services
import { UrlContentFetcher } from "../services/browser/UrlContentFetcher"
import { BrowserSession } from "../services/browser/BrowserSession"
import { McpHub } from "../services/mcp/McpHub"
import { ToolRepetitionDetector } from "./ToolRepetitionDetector"
import { McpServerManager } from "../services/mcp/McpServerManager"
import { telemetryService } from "../services/telemetry/TelemetryService"
import { CheckpointServiceOptions, RepoPerTaskCheckpointService } from "../services/checkpoints"

// integrations
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "../integrations/editor/DiffViewProvider"
import { findToolName, formatContentBlockToMarkdown } from "../integrations/misc/export-markdown"
import { RooTerminalProcess } from "../integrations/terminal/types"
import { TerminalRegistry } from "../integrations/terminal/TerminalRegistry"

// utils
import { calculateApiCostAnthropic } from "../utils/cost"
import { getWorkspacePath } from "../utils/path"

// tools
import { fetchInstructionsTool } from "./tools/fetchInstructionsTool"
import { listFilesTool } from "./tools/listFilesTool"
import { readFileTool } from "./tools/readFileTool"
import { writeToFileTool } from "./tools/writeToFileTool"
import { applyDiffTool } from "./tools/applyDiffTool"
import { insertContentTool } from "./tools/insertContentTool"
import { searchAndReplaceTool } from "./tools/searchAndReplaceTool"
import { listCodeDefinitionNamesTool } from "./tools/listCodeDefinitionNamesTool"
import { searchFilesTool } from "./tools/searchFilesTool"
import { browserActionTool } from "./tools/browserActionTool"
import { executeCommandTool } from "./tools/executeCommandTool"
import { useMcpToolTool } from "./tools/useMcpToolTool"
import { accessMcpResourceTool } from "./tools/accessMcpResourceTool"
import { askFollowupQuestionTool } from "./tools/askFollowupQuestionTool"
import { switchModeTool } from "./tools/switchModeTool"
import { attemptCompletionTool } from "./tools/attemptCompletionTool"
import { newTaskTool } from "./tools/newTaskTool"

// prompts
import { formatResponse } from "./prompts/responses"
import { SYSTEM_PROMPT } from "./prompts/system"

// ... everything else
import { parseMentions } from "./mentions"
import { FileContextTracker } from "./context-tracking/FileContextTracker"
import { RooIgnoreController } from "./ignore/RooIgnoreController"
import { type AssistantMessageContent, parseAssistantMessage } from "./assistant-message"
import { truncateConversationIfNeeded } from "./sliding-window"
import { ClineProvider } from "./webview/ClineProvider"
import { validateToolUse } from "./mode-validator"
import { MultiSearchReplaceDiffStrategy } from "./diff/strategies/multi-search-replace"
import { readApiMessages, saveApiMessages, readTaskMessages, saveTaskMessages, taskMetadata } from "./task-persistence"
import { getEnvironmentDetails } from "./environment/getEnvironmentDetails"

type UserContent = Array<Anthropic.Messages.ContentBlockParam>

export type ClineEvents = {
	message: [{ action: "created" | "updated"; message: ClineMessage }]
	taskStarted: []
	taskModeSwitched: [taskId: string, mode: string]
	taskPaused: []
	taskUnpaused: []
	taskAskResponded: []
	taskAborted: []
	taskSpawned: [taskId: string]
	taskCompleted: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	taskTokenUsageUpdated: [taskId: string, tokenUsage: TokenUsage]
	taskToolFailed: [taskId: string, tool: ToolName, error: string]
}

export type ClineOptions = {
	provider: ClineProvider
	apiConfiguration: ApiConfiguration
	customInstructions?: string
	enableDiff?: boolean
	enableCheckpoints?: boolean
	fuzzyMatchThreshold?: number
	consecutiveMistakeLimit?: number
	task?: string
	images?: string[]
	historyItem?: HistoryItem
	experiments?: Record<string, boolean>
	startTask?: boolean
	rootTask?: Cline
	parentTask?: Cline
	taskNumber?: number
	onCreated?: (cline: Cline) => void
}

export class Cline extends EventEmitter<ClineEvents> {
	readonly taskId: string
	readonly instanceId: string

	readonly rootTask: Cline | undefined = undefined
	readonly parentTask: Cline | undefined = undefined
	readonly taskNumber: number
	readonly workspacePath: string

	isPaused: boolean = false
	pausedModeSlug: string = defaultModeSlug
	private pauseInterval: NodeJS.Timeout | undefined

	readonly apiConfiguration: ApiConfiguration
	api: ApiHandler
	private promptCacheKey: string

	rooIgnoreController?: RooIgnoreController
	fileContextTracker: FileContextTracker
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	didEditFile: boolean = false
	customInstructions?: string

	diffStrategy?: DiffStrategy
	diffEnabled: boolean = false
	fuzzyMatchThreshold: number

	apiConversationHistory: (Anthropic.MessageParam & { ts?: number })[] = []
	clineMessages: ClineMessage[] = []

	private askResponse?: ClineAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	public lastMessageTs?: number

	// Not private since it needs to be accessible by tools.
	consecutiveMistakeCount: number = 0
	consecutiveMistakeLimit: number
	consecutiveMistakeCountForApplyDiff: Map<string, number> = new Map()

	// For tracking identical consecutive tool calls
	private toolRepetitionDetector: ToolRepetitionDetector

	// Not private since it needs to be accessible by tools.
	providerRef: WeakRef<ClineProvider>
	private readonly globalStoragePath: string
	private abort: boolean = false
	didFinishAbortingStream = false
	abandoned = false
	diffViewProvider: DiffViewProvider
	private lastApiRequestTime?: number
	isInitialized = false

	// checkpoints
	private enableCheckpoints: boolean
	private checkpointService?: RepoPerTaskCheckpointService
	private checkpointServiceInitializing = false

	// streaming
	isWaitingForFirstChunk = false
	isStreaming = false
	private currentStreamingContentIndex = 0
	private assistantMessageContent: AssistantMessageContent[] = []
	private presentAssistantMessageLocked = false
	private presentAssistantMessageHasPendingUpdates = false
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
	private userMessageContentReady = false
	didRejectTool = false
	private didAlreadyUseTool = false
	private didCompleteReadingStream = false

	// metrics
	private toolUsage: ToolUsage = {}

	// terminal
	public terminalProcess?: RooTerminalProcess

	constructor({
		provider,
		apiConfiguration,
		customInstructions,
		enableDiff = false,
		enableCheckpoints = true,
		fuzzyMatchThreshold = 1.0,
		consecutiveMistakeLimit = 3,
		task,
		images,
		historyItem,
		startTask = true,
		rootTask,
		parentTask,
		taskNumber = -1,
		onCreated,
	}: ClineOptions) {
		super()

		if (startTask && !task && !images && !historyItem) {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.taskId = historyItem ? historyItem.id : crypto.randomUUID()
		// normal use-case is usually retry similar history task with new workspace
		this.workspacePath = parentTask
			? parentTask.workspacePath
			: getWorkspacePath(path.join(os.homedir(), "Desktop"))
		this.instanceId = crypto.randomUUID().slice(0, 8)
		this.taskNumber = -1

		this.rooIgnoreController = new RooIgnoreController(this.cwd)
		this.fileContextTracker = new FileContextTracker(provider, this.taskId)

		this.rooIgnoreController.initialize().catch((error) => {
			console.error("Failed to initialize RooIgnoreController:", error)
		})

		this.apiConfiguration = apiConfiguration
		this.api = buildApiHandler(apiConfiguration)
		this.promptCacheKey = crypto.randomUUID()

		this.urlContentFetcher = new UrlContentFetcher(provider.context)
		this.browserSession = new BrowserSession(provider.context)
		this.customInstructions = customInstructions
		this.diffEnabled = enableDiff
		this.fuzzyMatchThreshold = fuzzyMatchThreshold
		this.consecutiveMistakeLimit = consecutiveMistakeLimit
		this.providerRef = new WeakRef(provider)
		this.globalStoragePath = provider.context.globalStorageUri.fsPath
		this.diffViewProvider = new DiffViewProvider(this.cwd)
		this.enableCheckpoints = enableCheckpoints

		this.rootTask = rootTask
		this.parentTask = parentTask
		this.taskNumber = taskNumber

		if (historyItem) {
			telemetryService.captureTaskRestarted(this.taskId)
		} else {
			telemetryService.captureTaskCreated(this.taskId)
		}

		this.diffStrategy = new MultiSearchReplaceDiffStrategy(this.fuzzyMatchThreshold)
		this.toolRepetitionDetector = new ToolRepetitionDetector(this.consecutiveMistakeLimit)

		onCreated?.(this)

		if (startTask) {
			if (task || images) {
				this.startTask(task, images)
			} else if (historyItem) {
				this.resumeTaskFromHistory()
			} else {
				throw new Error("Either historyItem or task/images must be provided")
			}
		}
	}

	static create(options: ClineOptions): [Cline, Promise<void>] {
		const instance = new Cline({ ...options, startTask: false })
		const { images, task, historyItem } = options
		let promise

		if (images || task) {
			promise = instance.startTask(task, images)
		} else if (historyItem) {
			promise = instance.resumeTaskFromHistory()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		return [instance, promise]
	}

	// API Messages

	private async getSavedApiConversationHistory(): Promise<Anthropic.MessageParam[]> {
		return readApiMessages({ taskId: this.taskId, globalStoragePath: this.globalStoragePath })
	}

	private async addToApiConversationHistory(message: Anthropic.MessageParam) {
		const messageWithTs = { ...message, ts: Date.now() }
		this.apiConversationHistory.push(messageWithTs)
		await this.saveApiConversationHistory()
	}

	async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]) {
		this.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	private async saveApiConversationHistory() {
		try {
			await saveApiMessages({
				messages: this.apiConversationHistory,
				taskId: this.taskId,
				globalStoragePath: this.globalStoragePath,
			})
		} catch (error) {
			// In the off chance this fails, we don't want to stop the task.
			console.error("Failed to save API conversation history:", error)
		}
	}

	// Cline Messages

	private async getSavedClineMessages(): Promise<ClineMessage[]> {
		return readTaskMessages({ taskId: this.taskId, globalStoragePath: this.globalStoragePath })
	}

	private async addToClineMessages(message: ClineMessage) {
		this.clineMessages.push(message)
		await this.providerRef.deref()?.postStateToWebview()
		this.emit("message", { action: "created", message })
		await this.saveClineMessages()
	}

	public async overwriteClineMessages(newMessages: ClineMessage[]) {
		// Reset the the prompt cache key since we've altered the conversation history.
		this.promptCacheKey = crypto.randomUUID()
		this.clineMessages = newMessages
		await this.saveClineMessages()
	}

	private async updateClineMessage(partialMessage: ClineMessage) {
		await this.providerRef.deref()?.postMessageToWebview({ type: "partialMessage", partialMessage })
		this.emit("message", { action: "updated", message: partialMessage })
	}

	private async saveClineMessages() {
		try {
			await saveTaskMessages({
				messages: this.clineMessages,
				taskId: this.taskId,
				globalStoragePath: this.globalStoragePath,
			})

			const { historyItem, tokenUsage } = await taskMetadata({
				messages: this.clineMessages,
				taskId: this.taskId,
				taskNumber: this.taskNumber,
				globalStoragePath: this.globalStoragePath,
				workspace: this.cwd,
			})

			this.emit("taskTokenUsageUpdated", this.taskId, tokenUsage)

			await this.providerRef.deref()?.updateTaskHistory(historyItem)
		} catch (error) {
			console.error("Failed to save cline messages:", error)
		}
	}

	// Note that `partial` has three valid states true (partial message),
	// false (completion of partial message), undefined (individual complete
	// message).
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: ToolProgressStatus,
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
		// If this Cline instance was aborted by the provider, then the only
		// thing keeping us alive is a promise still running in the background,
		// in which case we don't want to send its result to the webview as it
		// is attached to a new instance of Cline now. So we can safely ignore
		// the result of any active promises, and this class will be
		// deallocated. (Although we set Cline = undefined in provider, that
		// simply removes the reference to this instance, but the instance is
		// still alive until this promise resolves or rejects.)
		if (this.abort) {
			throw new Error(`[Cline#ask] task ${this.taskId}.${this.instanceId} aborted`)
		}

		let askTs: number

		if (partial !== undefined) {
			const lastMessage = this.clineMessages.at(-1)

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					// Existing partial message, so update it.
					lastMessage.text = text
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					// TODO: Be more efficient about saving and posting only new
					// data or one whole message at a time so ignore partial for
					// saves, and only post parts of partial message instead of
					// whole array in new listener.
					this.updateClineMessage(lastMessage)
					throw new Error("Current ask promise was ignored (#1)")
				} else {
					// This is a new partial message, so add it with partial
					// state.
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, partial })
					throw new Error("Current ask promise was ignored (#2)")
				}
			} else {
				if (isUpdatingPreviousPartial) {
					// This is the complete version of a previously partial
					// message, so replace the partial with the complete version.
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined

					// Bug for the history books:
					// In the webview we use the ts as the chatrow key for the
					// virtuoso list. Since we would update this ts right at the
					// end of streaming, it would cause the view to flicker. The
					// key prop has to be stable otherwise react has trouble
					// reconciling items between renders, causing unmounting and
					// remounting of components (flickering).
					// The lesson here is if you see flickering when rendering
					// lists, it's likely because the key prop is not stable.
					// So in this case we must make sure that the message ts is
					// never altered after first setting it.
					askTs = lastMessage.ts
					this.lastMessageTs = askTs
					lastMessage.text = text
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus
					await this.saveClineMessages()
					this.updateClineMessage(lastMessage)
				} else {
					// This is a new and complete message, so add it like normal.
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text })
				}
			}
		} else {
			// This is a new non-partial message, so add it like normal.
			this.askResponse = undefined
			this.askResponseText = undefined
			this.askResponseImages = undefined
			askTs = Date.now()
			this.lastMessageTs = askTs
			await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text })
		}

		await pWaitFor(() => this.askResponse !== undefined || this.lastMessageTs !== askTs, { interval: 100 })

		if (this.lastMessageTs !== askTs) {
			// Could happen if we send multiple asks in a row i.e. with
			// command_output. It's important that when we know an ask could
			// fail, it is handled gracefully.
			throw new Error("Current ask promise was ignored")
		}

		const result = { response: this.askResponse!, text: this.askResponseText, images: this.askResponseImages }
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined
		this.emit("taskAskResponded")
		return result
	}

	async handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]) {
		this.askResponse = askResponse
		this.askResponseText = text
		this.askResponseImages = images
	}

	async handleTerminalOperation(terminalOperation: "continue" | "abort") {
		if (terminalOperation === "continue") {
			this.terminalProcess?.continue()
		} else if (terminalOperation === "abort") {
			this.terminalProcess?.abort()
		}
	}

	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		checkpoint?: Record<string, unknown>,
		progressStatus?: ToolProgressStatus,
	): Promise<undefined> {
		if (this.abort) {
			throw new Error(`[Cline#say] task ${this.taskId}.${this.instanceId} aborted`)
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
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					this.updateClineMessage(lastMessage)
				} else {
					// this is a new partial message, so add it with partial state
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images, partial })
				}
			} else {
				// New now have a complete version of a previously partial message.
				if (isUpdatingPreviousPartial) {
					// This is the complete version of a previously partial
					// message, so replace the partial with the complete version.
					this.lastMessageTs = lastMessage.ts
					// lastMessage.ts = sayTs
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus
					// Instead of streaming partialMessage events, we do a save
					// and post like normal to persist to disk.
					await this.saveClineMessages()
					// More performant than an entire postStateToWebview.
					this.updateClineMessage(lastMessage)
				} else {
					// This is a new and complete message, so add it like normal.
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images })
				}
			}
		} else {
			// this is a new non-partial message, so add it like normal
			const sayTs = Date.now()
			this.lastMessageTs = sayTs
			await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images, checkpoint })
		}
	}

	async sayAndCreateMissingParamError(toolName: ToolName, paramName: string, relPath?: string) {
		await this.say(
			"error",
			`Roo tried to use ${toolName}${
				relPath ? ` for '${relPath.toPosix()}'` : ""
			} without value for required parameter '${paramName}'. Retrying...`,
		)
		return formatResponse.toolError(formatResponse.missingToolParameterError(paramName))
	}

	// Start / Abort / Resume

	private async startTask(task?: string, images?: string[]): Promise<void> {
		// conversationHistory (for API) and clineMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the clineMessages might not be empty, so we need to set it to [] when we create a new Cline client (otherwise webview would show stale messages from previous session)
		this.clineMessages = []
		this.apiConversationHistory = []
		await this.providerRef.deref()?.postStateToWebview()

		await this.say("text", task, images)
		this.isInitialized = true

		let imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)

		console.log(`[subtasks] task ${this.taskId}.${this.instanceId} starting`)

		await this.initiateTaskLoop([
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		])
	}

	public async resumePausedTask(lastMessage: string) {
		// release this Cline instance from paused state
		this.isPaused = false
		this.emit("taskUnpaused")

		// fake an answer from the subtask that it has completed running and this is the result of what it has done
		// add the message to the chat history and to the webview ui
		try {
			await this.say("subtask_result", lastMessage)

			await this.addToApiConversationHistory({
				role: "user",
				content: [
					{
						type: "text",
						text: `[new_task completed] Result: ${lastMessage}`,
					},
				],
			})
		} catch (error) {
			this.providerRef
				.deref()
				?.log(`Error failed to add reply from subtast into conversation of parent task, error: ${error}`)
			throw error
		}
	}

	private async resumeTaskFromHistory() {
		const modifiedClineMessages = await this.getSavedClineMessages()

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
		this.clineMessages = await this.getSavedClineMessages()

		// Now present the cline messages to the user and ask if they want to
		// resume (NOTE: we ran into a bug before where the
		// apiConversationHistory wouldn't be initialized when opening a old
		// task, and it was because we were waiting for resume).
		// This is important in case the user deletes messages without resuming
		// the task first.
		this.apiConversationHistory = await this.getSavedApiConversationHistory()

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

		const { response, text, images } = await this.ask(askType) // calls poststatetowebview
		let responseText: string | undefined
		let responseImages: string[] | undefined
		if (response === "messageResponse") {
			await this.say("user_feedback", text, images)
			responseText = text
			responseImages = images
		}

		// Make sure that the api conversation history can be resumed by the API,
		// even if it goes out of sync with cline messages.
		let existingApiConversationHistory: Anthropic.Messages.MessageParam[] =
			await this.getSavedApiConversationHistory()

		// v2.0 xml tags refactor caveat: since we don't use tools anymore, we need to replace all tool use blocks with a text block since the API disallows conversations with tool uses and no tool schema
		const conversationWithoutToolBlocks = existingApiConversationHistory.map((message) => {
			if (Array.isArray(message.content)) {
				const newContent = message.content.map((block) => {
					if (block.type === "tool_use") {
						// it's important we convert to the new tool schema format so the model doesn't get confused about how to invoke tools
						const inputAsXml = Object.entries(block.input as Record<string, string>)
							.map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
							.join("\n")
						return {
							type: "text",
							text: `<${block.name}>\n${inputAsXml}\n</${block.name}>`,
						} as Anthropic.Messages.TextBlockParam
					} else if (block.type === "tool_result") {
						// Convert block.content to text block array, removing images
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

		// FIXME: remove tool use blocks altogether

		// if the last message is an assistant message, we need to check if there's tool use since every tool use has to have a tool response
		// if there's no tool use and only a text block, then we can just add a user message
		// (note this isn't relevant anymore since we use custom tool prompts instead of tool use blocks, but this is here for legacy purposes in case users resume old tasks)

		// if the last message is a user message, we can need to get the assistant message before it to see if it made tool calls, and if so, fill in the remaining tool responses with 'interrupted'

		let modifiedOldUserContent: UserContent // either the last message if its user message, or the user message before the last (assistant) message
		let modifiedApiConversationHistory: Anthropic.Messages.MessageParam[] // need to remove the last user message to replace with new modified user message
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
						: [{ type: "text", text: previousAssistantMessage.content }]

					const toolUseBlocks = assistantContent.filter(
						(block) => block.type === "tool_use",
					) as Anthropic.Messages.ToolUseBlock[]

					if (toolUseBlocks.length > 0) {
						const existingToolResults = existingUserContent.filter(
							(block) => block.type === "tool_result",
						) as Anthropic.ToolResultBlockParam[]

						const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
							.filter(
								(toolUse) => !existingToolResults.some((result) => result.tool_use_id === toolUse.id),
							)
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
		}

		let newUserContent: UserContent = [...modifiedOldUserContent]

		const agoText = ((): string => {
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

		const lastTaskResumptionIndex = newUserContent.findIndex(
			(x) => x.type === "text" && x.text.startsWith("[TASK RESUMPTION]"),
		)
		if (lastTaskResumptionIndex !== -1) {
			newUserContent.splice(lastTaskResumptionIndex, newUserContent.length - lastTaskResumptionIndex)
		}

		const wasRecent = lastClineMessage?.ts && Date.now() - lastClineMessage.ts < 30_000

		newUserContent.push({
			type: "text",
			text:
				`[TASK RESUMPTION] This task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. If the task has not been completed, retry the last step before interruption and proceed with completing the task.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.${
					wasRecent
						? "\n\nIMPORTANT: If the last tool use was a write_to_file that was interrupted, the file was reverted back to its original state before the interrupted edit, and you do NOT need to re-read the file as you already have its up-to-date contents."
						: ""
				}` +
				(responseText
					? `\n\nNew instructions for task continuation:\n<user_message>\n${responseText}\n</user_message>`
					: ""),
		})

		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...formatResponse.imageBlocks(responseImages))
		}

		await this.overwriteApiConversationHistory(modifiedApiConversationHistory)

		console.log(`[subtasks] task ${this.taskId}.${this.instanceId} resuming from history item`)

		await this.initiateTaskLoop(newUserContent)
	}

	public async abortTask(isAbandoned = false) {
		console.log(`[subtasks] aborting task ${this.taskId}.${this.instanceId}`)

		// Will stop any autonomously running promises.
		if (isAbandoned) {
			this.abandoned = true
		}

		this.abort = true
		this.emit("taskAborted")

		// Stop waiting for child task completion.
		if (this.pauseInterval) {
			clearInterval(this.pauseInterval)
			this.pauseInterval = undefined
		}

		// Release any terminals associated with this task.
		TerminalRegistry.releaseTerminalsForTask(this.taskId)

		this.urlContentFetcher.closeBrowser()
		this.browserSession.closeBrowser()
		this.rooIgnoreController?.dispose()
		this.fileContextTracker.dispose()

		// If we're not streaming then `abortStream` (which reverts the diff
		// view changes) won't be called, so we need to revert the changes here.
		if (this.isStreaming && this.diffViewProvider.isEditing) {
			await this.diffViewProvider.revertChanges()
		}

		// Save the countdown message in the automatic retry or other content.
		await this.saveClineMessages()
	}

	// Used when a sub-task is launched and the parent task is waiting for it to
	// finish.
	// TBD: The 1s should be added to the settings, also should add a timeout to
	// prevent infinite waiting.
	public async waitForResume() {
		await new Promise<void>((resolve) => {
			this.pauseInterval = setInterval(() => {
				if (!this.isPaused) {
					clearInterval(this.pauseInterval)
					this.pauseInterval = undefined
					resolve()
				}
			}, 1000)
		})
	}

	// Task Loop

	private async initiateTaskLoop(userContent: UserContent): Promise<void> {
		// Kicks off the checkpoints initialization process in the background.
		this.getCheckpointService()

		let nextUserContent = userContent
		let includeFileDetails = true

		this.emit("taskStarted")

		while (!this.abort) {
			const didEndLoop = await this.recursivelyMakeClineRequests(nextUserContent, includeFileDetails)
			includeFileDetails = false // we only need file details the first time

			// The way this agentic loop works is that cline will be given a
			// task that he then calls tools to complete. Unless there's an
			// attempt_completion call, we keep responding back to him with his
			// tool's responses until he either attempt_completion or does not
			// use anymore tools. If he does not use anymore tools, we ask him
			// to consider if he's completed the task and then call
			// attempt_completion, otherwise proceed with completing the task.
			// There is a MAX_REQUESTS_PER_TASK limit to prevent infinite
			// requests, but Cline is prompted to finish the task as efficiently
			// as he can.

			if (didEndLoop) {
				// For now a task never 'completes'. This will only happen if
				// the user hits max requests and denies resetting the count.
				break
			} else {
				nextUserContent = [{ type: "text", text: formatResponse.noToolsUsed() }]
				this.consecutiveMistakeCount++
			}
		}
	}

	public async recursivelyMakeClineRequests(
		userContent: UserContent,
		includeFileDetails: boolean = false,
	): Promise<boolean> {
		if (this.abort) {
			throw new Error(`[Cline#recursivelyMakeClineRequests] task ${this.taskId}.${this.instanceId} aborted`)
		}

		if (this.consecutiveMistakeCount >= this.consecutiveMistakeLimit) {
			const { response, text, images } = await this.ask(
				"mistake_limit_reached",
				this.api.getModel().id.includes("claude")
					? `This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
					: "Roo Code uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 3.7 Sonnet for its advanced agentic coding capabilities.",
			)

			if (response === "messageResponse") {
				userContent.push(
					...[
						{ type: "text" as const, text: formatResponse.tooManyMistakes(text) },
						...formatResponse.imageBlocks(images),
					],
				)

				await this.say("user_feedback", text, images)

				// Track consecutive mistake errors in telemetry.
				telemetryService.captureConsecutiveMistakeError(this.taskId)
			}

			this.consecutiveMistakeCount = 0
		}

		// Get previous api req's index to check token usage and determine if we
		// need to truncate conversation history.
		const previousApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")

		// In this Cline request loop, we need to check if this task instance
		// has been asked to wait for a subtask to finish before continuing.
		const provider = this.providerRef.deref()

		if (this.isPaused && provider) {
			provider.log(`[subtasks] paused ${this.taskId}.${this.instanceId}`)
			await this.waitForResume()
			provider.log(`[subtasks] resumed ${this.taskId}.${this.instanceId}`)
			const currentMode = (await provider.getState())?.mode ?? defaultModeSlug

			if (currentMode !== this.pausedModeSlug) {
				// The mode has changed, we need to switch back to the paused mode.
				await provider.handleModeSwitch(this.pausedModeSlug)

				// Delay to allow mode change to take effect before next tool is executed.
				await delay(500)

				provider.log(
					`[subtasks] task ${this.taskId}.${this.instanceId} has switched back to '${this.pausedModeSlug}' from '${currentMode}'`,
				)
			}
		}

		// Getting verbose details is an expensive operation, it uses ripgrep to
		// top-down build file structure of project which for large projects can
		// take a few seconds. For the best UX we show a placeholder api_req_started
		// message with a loading spinner as this happens.
		await this.say(
			"api_req_started",
			JSON.stringify({
				request:
					userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
			}),
		)

		const parsedUserContent = await this.parseUserContent(userContent)
		const environmentDetails = await getEnvironmentDetails(this, includeFileDetails)

		// Add environment details as its own text block, separate from tool
		// results.
		const finalUserContent = [...parsedUserContent, { type: "text" as const, text: environmentDetails }]

		await this.addToApiConversationHistory({ role: "user", content: finalUserContent })
		telemetryService.captureConversationMessage(this.taskId, "user")

		// Since we sent off a placeholder api_req_started message to update the
		// webview while waiting to actually start the API request (to load
		// potential details for example), we need to update the text of that
		// message.
		const lastApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")

		this.clineMessages[lastApiReqIndex].text = JSON.stringify({
			request: finalUserContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
		} satisfies ClineApiReqInfo)

		await this.saveClineMessages()
		await provider?.postStateToWebview()

		try {
			let cacheWriteTokens = 0
			let cacheReadTokens = 0
			let inputTokens = 0
			let outputTokens = 0
			let totalCost: number | undefined

			// We can't use `api_req_finished` anymore since it's a unique case
			// where it could come after a streaming message (i.e. in the middle
			// of being updated or executed).
			// Fortunately `api_req_finished` was always parsed out for the GUI
			// anyways, so it remains solely for legacy purposes to keep track
			// of prices in tasks from history (it's worth removing a few months
			// from now).
			const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				this.clineMessages[lastApiReqIndex].text = JSON.stringify({
					...JSON.parse(this.clineMessages[lastApiReqIndex].text || "{}"),
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
					// await this.saveClineMessages()
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

				// Update `api_req_started` to have cancelled and cost, so that
				// we can display the cost of the partial stream.
				updateApiReqMsg(cancelReason, streamingFailedMessage)
				await this.saveClineMessages()

				// Signals to provider that it can retrieve the saved messages
				// from disk, as abortTask can not be awaited on in nature.
				this.didFinishAbortingStream = true
			}

			// Reset streaming state.
			this.currentStreamingContentIndex = 0
			this.assistantMessageContent = []
			this.didCompleteReadingStream = false
			this.userMessageContent = []
			this.userMessageContentReady = false
			this.didRejectTool = false
			this.didAlreadyUseTool = false
			this.presentAssistantMessageLocked = false
			this.presentAssistantMessageHasPendingUpdates = false

			await this.diffViewProvider.reset()

			// Yields only if the first chunk is successful, otherwise will
			// allow the user to retry the request (most likely due to rate
			// limit error, which gets thrown on the first chunk).
			const stream = this.attemptApiRequest(previousApiReqIndex)
			let assistantMessage = ""
			let reasoningMessage = ""
			this.isStreaming = true

			try {
				for await (const chunk of stream) {
					if (!chunk) {
						// Sometimes chunk is undefined, no idea that can cause
						// it, but this workaround seems to fix it.
						continue
					}

					switch (chunk.type) {
						case "reasoning":
							reasoningMessage += chunk.text
							await this.say("reasoning", reasoningMessage, undefined, true)
							break
						case "usage":
							inputTokens += chunk.inputTokens
							outputTokens += chunk.outputTokens
							cacheWriteTokens += chunk.cacheWriteTokens ?? 0
							cacheReadTokens += chunk.cacheReadTokens ?? 0
							totalCost = chunk.totalCost
							break
						case "text":
							assistantMessage += chunk.text

							// Parse raw assistant message into content blocks.
							const prevLength = this.assistantMessageContent.length
							this.assistantMessageContent = parseAssistantMessage(assistantMessage)

							if (this.assistantMessageContent.length > prevLength) {
								// New content we need to present, reset to
								// false in case previous content set this to true.
								this.userMessageContentReady = false
							}

							// Present content to user.
							this.presentAssistantMessage()
							break
					}

					if (this.abort) {
						console.log(`aborting stream, this.abandoned = ${this.abandoned}`)

						if (!this.abandoned) {
							// Only need to gracefully abort if this instance
							// isn't abandoned (sometimes OpenRouter stream
							// hangs, in which case this would affect future
							// instances of Cline).
							await abortStream("user_cancelled")
						}

						break // Aborts the stream.
					}

					if (this.didRejectTool) {
						// `userContent` has a tool rejection, so interrupt the
						// assistant's response to present the user's feedback.
						assistantMessage += "\n\n[Response interrupted by user feedback]"
						// Instead of setting this premptively, we allow the
						// present iterator to finish and set
						// userMessageContentReady when its ready.
						// this.userMessageContentReady = true
						break
					}

					// PREV: We need to let the request finish for openrouter to
					// get generation details.
					// UPDATE: It's better UX to interrupt the request at the
					// cost of the API cost not being retrieved.
					if (this.didAlreadyUseTool) {
						assistantMessage +=
							"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
						break
					}
				}
			} catch (error) {
				// Abandoned happens when extension is no longer waiting for the
				// Cline instance to finish aborting (error is thrown here when
				// any function in the for loop throws due to this.abort).
				if (!this.abandoned) {
					// If the stream failed, there's various states the task
					// could be in (i.e. could have streamed some tools the user
					// may have executed), so we just resort to replicating a
					// cancel task.
					this.abortTask()

					await abortStream(
						"streaming_failed",
						error.message ?? JSON.stringify(serializeError(error), null, 2),
					)

					const history = await provider?.getTaskWithId(this.taskId)

					if (history) {
						await provider?.initClineWithHistoryItem(history.historyItem)
					}
				}
			} finally {
				this.isStreaming = false
			}

			// Need to call here in case the stream was aborted.
			if (this.abort || this.abandoned) {
				throw new Error(`[Cline#recursivelyMakeClineRequests] task ${this.taskId}.${this.instanceId} aborted`)
			}

			this.didCompleteReadingStream = true

			// Set any blocks to be complete to allow `presentAssistantMessage`
			// to finish and set `userMessageContentReady` to true.
			// (Could be a text block that had no subsequent tool uses, or a
			// text block at the very end, or an invalid tool use, etc. Whatever
			// the case, `presentAssistantMessage` relies on these blocks either
			// to be completed or the user to reject a block in order to proceed
			// and eventually set userMessageContentReady to true.)
			const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
			partialBlocks.forEach((block) => (block.partial = false))

			// Can't just do this b/c a tool could be in the middle of executing.
			// this.assistantMessageContent.forEach((e) => (e.partial = false))

			if (partialBlocks.length > 0) {
				// If there is content to update then it will complete and
				// update `this.userMessageContentReady` to true, which we
				// `pWaitFor` before making the next request. All this is really
				// doing is presenting the last partial message that we just set
				// to complete.
				this.presentAssistantMessage()
			}

			updateApiReqMsg()
			await this.saveClineMessages()
			await this.providerRef.deref()?.postStateToWebview()

			// Now add to apiConversationHistory.
			// Need to save assistant responses to file before proceeding to
			// tool use since user can exit at any moment and we wouldn't be
			// able to save the assistant's response.
			let didEndLoop = false

			if (assistantMessage.length > 0) {
				await this.addToApiConversationHistory({
					role: "assistant",
					content: [{ type: "text", text: assistantMessage }],
				})

				telemetryService.captureConversationMessage(this.taskId, "assistant")

				// NOTE: This comment is here for future reference - this was a
				// workaround for `userMessageContent` not getting set to true.
				// It was due to it not recursively calling for partial blocks
				// when `didRejectTool`, so it would get stuck waiting for a
				// partial block to complete before it could continue.
				// In case the content blocks finished it may be the api stream
				// finished after the last parsed content block was executed, so
				// we are able to detect out of bounds and set
				// `userMessageContentReady` to true (note you should not call
				// `presentAssistantMessage` since if the last block i
				//  completed it will be presented again).
				// const completeBlocks = this.assistantMessageContent.filter((block) => !block.partial) // If there are any partial blocks after the stream ended we can consider them invalid.
				// if (this.currentStreamingContentIndex >= completeBlocks.length) {
				// 	this.userMessageContentReady = true
				// }

				await pWaitFor(() => this.userMessageContentReady)

				// If the model did not tool use, then we need to tell it to
				// either use a tool or attempt_completion.
				const didToolUse = this.assistantMessageContent.some((block) => block.type === "tool_use")

				if (!didToolUse) {
					this.userMessageContent.push({ type: "text", text: formatResponse.noToolsUsed() })
					this.consecutiveMistakeCount++
				}

				const recDidEndLoop = await this.recursivelyMakeClineRequests(this.userMessageContent)
				didEndLoop = recDidEndLoop
			} else {
				// If there's no assistant_responses, that means we got no text
				// or tool_use content blocks from API which we should assume is
				// an error.
				await this.say(
					"error",
					"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
				)

				await this.addToApiConversationHistory({
					role: "assistant",
					content: [{ type: "text", text: "Failure: I did not provide a response." }],
				})
			}

			return didEndLoop // Will always be false for now.
		} catch (error) {
			// This should never happen since the only thing that can throw an
			// error is the attemptApiRequest, which is wrapped in a try catch
			// that sends an ask where if noButtonClicked, will clear current
			// task and destroy this instance. However to avoid unhandled
			// promise rejection, we will end this loop which will end execution
			// of this instance (see `startTask`).
			return true // Needs to be true so parent loop knows to end task.
		}
	}

	public async *attemptApiRequest(previousApiReqIndex: number, retryAttempt: number = 0): ApiStream {
		let mcpHub: McpHub | undefined

		const { apiConfiguration, mcpEnabled, autoApprovalEnabled, alwaysApproveResubmit, requestDelaySeconds } =
			(await this.providerRef.deref()?.getState()) ?? {}

		let rateLimitDelay = 0

		// Only apply rate limiting if this isn't the first request
		if (this.lastApiRequestTime) {
			const now = Date.now()
			const timeSinceLastRequest = now - this.lastApiRequestTime
			const rateLimit = apiConfiguration?.rateLimitSeconds || 0
			rateLimitDelay = Math.ceil(Math.max(0, rateLimit * 1000 - timeSinceLastRequest) / 1000)
		}

		// Only show rate limiting message if we're not retrying. If retrying, we'll include the delay there.
		if (rateLimitDelay > 0 && retryAttempt === 0) {
			// Show countdown timer
			for (let i = rateLimitDelay; i > 0; i--) {
				const delayMessage = `Rate limiting for ${i} seconds...`
				await this.say("api_req_retry_delayed", delayMessage, undefined, true)
				await delay(1000)
			}
		}

		// Update last request time before making the request
		this.lastApiRequestTime = Date.now()

		if (mcpEnabled ?? true) {
			const provider = this.providerRef.deref()

			if (!provider) {
				throw new Error("Provider reference lost during view transition")
			}

			// Wait for MCP hub initialization through McpServerManager
			mcpHub = await McpServerManager.getInstance(provider.context, provider)

			if (!mcpHub) {
				throw new Error("Failed to get MCP hub from server manager")
			}

			// Wait for MCP servers to be connected before generating system prompt
			await pWaitFor(() => !mcpHub!.isConnecting, { timeout: 10_000 }).catch(() => {
				console.error("MCP servers failed to connect in time")
			})
		}

		const rooIgnoreInstructions = this.rooIgnoreController?.getInstructions()

		const {
			browserViewportSize,
			mode,
			customModePrompts,
			experiments,
			enableMcpServerCreation,
			browserToolEnabled,
			language,
		} = (await this.providerRef.deref()?.getState()) ?? {}

		const { customModes } = (await this.providerRef.deref()?.getState()) ?? {}

		const systemPrompt = await (async () => {
			const provider = this.providerRef.deref()

			if (!provider) {
				throw new Error("Provider not available")
			}

			return SYSTEM_PROMPT(
				provider.context,
				this.cwd,
				(this.api.getModel().info.supportsComputerUse ?? false) && (browserToolEnabled ?? true),
				mcpHub,
				this.diffStrategy,
				browserViewportSize,
				mode,
				customModePrompts,
				customModes,
				this.customInstructions,
				this.diffEnabled,
				experiments,
				enableMcpServerCreation,
				language,
				rooIgnoreInstructions,
			)
		})()

		// If the previous API request's total token usage is close to the
		// context window, truncate the conversation history to free up space
		// for the new request.
		if (previousApiReqIndex >= 0) {
			const previousRequest = this.clineMessages[previousApiReqIndex]?.text

			if (!previousRequest) {
				return
			}

			const {
				tokensIn = 0,
				tokensOut = 0,
				cacheWrites = 0,
				cacheReads = 0,
			}: ClineApiReqInfo = JSON.parse(previousRequest)

			const totalTokens = tokensIn + tokensOut + cacheWrites + cacheReads

			// Default max tokens value for thinking models when no specific
			// value is set.
			const DEFAULT_THINKING_MODEL_MAX_TOKENS = 16_384

			const modelInfo = this.api.getModel().info

			const maxTokens = modelInfo.thinking
				? this.apiConfiguration.modelMaxTokens || DEFAULT_THINKING_MODEL_MAX_TOKENS
				: modelInfo.maxTokens

			const contextWindow = modelInfo.contextWindow

			const trimmedMessages = await truncateConversationIfNeeded({
				messages: this.apiConversationHistory,
				totalTokens,
				maxTokens,
				contextWindow,
				apiHandler: this.api,
			})

			if (trimmedMessages !== this.apiConversationHistory) {
				await this.overwriteApiConversationHistory(trimmedMessages)
			}
		}

		// Clean conversation history by:
		// 1. Converting to Anthropic.MessageParam by spreading only the API-required properties.
		// 2. Converting image blocks to text descriptions if model doesn't support images.
		const cleanConversationHistory = this.apiConversationHistory.map(({ role, content }) => {
			// Handle array content (could contain image blocks).
			if (Array.isArray(content)) {
				if (!this.api.getModel().info.supportsImages) {
					// Convert image blocks to text descriptions.
					content = content.map((block) => {
						if (block.type === "image") {
							// Convert image blocks to text descriptions.
							// Note: We can't access the actual image content/url due to API limitations,
							// but we can indicate that an image was present in the conversation.
							return {
								type: "text",
								text: "[Referenced image in conversation]",
							}
						}
						return block
					})
				}
			}

			return { role, content }
		})

		const stream = this.api.createMessage(systemPrompt, cleanConversationHistory, this.promptCacheKey)
		const iterator = stream[Symbol.asyncIterator]()

		try {
			// Awaiting first chunk to see if it will throw an error.
			this.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			yield firstChunk.value
			this.isWaitingForFirstChunk = false
		} catch (error) {
			// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.
			if (autoApprovalEnabled && alwaysApproveResubmit) {
				let errorMsg

				if (error.error?.metadata?.raw) {
					errorMsg = JSON.stringify(error.error.metadata.raw, null, 2)
				} else if (error.message) {
					errorMsg = error.message
				} else {
					errorMsg = "Unknown error"
				}

				const baseDelay = requestDelaySeconds || 5
				let exponentialDelay = Math.ceil(baseDelay * Math.pow(2, retryAttempt))

				// If the error is a 429, and the error details contain a retry delay, use that delay instead of exponential backoff
				if (error.status === 429) {
					const geminiRetryDetails = error.errorDetails?.find(
						(detail: any) => detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
					)
					if (geminiRetryDetails) {
						const match = geminiRetryDetails?.retryDelay?.match(/^(\d+)s$/)
						if (match) {
							exponentialDelay = Number(match[1]) + 1
						}
					}
				}

				// Wait for the greater of the exponential delay or the rate limit delay
				const finalDelay = Math.max(exponentialDelay, rateLimitDelay)

				// Show countdown timer with exponential backoff
				for (let i = finalDelay; i > 0; i--) {
					await this.say(
						"api_req_retry_delayed",
						`${errorMsg}\n\nRetry attempt ${retryAttempt + 1}\nRetrying in ${i} seconds...`,
						undefined,
						true,
					)
					await delay(1000)
				}

				await this.say(
					"api_req_retry_delayed",
					`${errorMsg}\n\nRetry attempt ${retryAttempt + 1}\nRetrying now...`,
					undefined,
					false,
				)

				// Delegate generator output from the recursive call with
				// incremented retry count.
				yield* this.attemptApiRequest(previousApiReqIndex, retryAttempt + 1)

				return
			} else {
				const { response } = await this.ask(
					"api_req_failed",
					error.message ?? JSON.stringify(serializeError(error), null, 2),
				)

				if (response !== "yesButtonClicked") {
					// This will never happen since if noButtonClicked, we will
					// clear current task, aborting this instance.
					throw new Error("API request failed")
				}

				await this.say("api_req_retried")

				// Delegate generator output from the recursive call.
				yield* this.attemptApiRequest(previousApiReqIndex)
				return
			}
		}

		// No error, so we can continue to yield all remaining chunks.
		// (Needs to be placed outside of try/catch since it we want caller to
		// handle errors not with api_req_failed as that is reserved for first
		// chunk failures only.)
		// This delegates to another generator or iterable object. In this case,
		// it's saying "yield all remaining values from this iterator". This
		// effectively passes along all subsequent chunks from the original
		// stream.
		yield* iterator
	}

	public async presentAssistantMessage() {
		if (this.abort) {
			throw new Error(`[Cline#presentAssistantMessage] task ${this.taskId}.${this.instanceId} aborted`)
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
					// content = content.replace(/<\/?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?$/, "")
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
				await this.say("text", content, undefined, block.partial)
				break
			}
			case "tool_use":
				const toolDescription = (): string => {
					switch (block.name) {
						case "execute_command":
							return `[${block.name} for '${block.params.command}']`
						case "read_file":
							return `[${block.name} for '${block.params.path}']`
						case "fetch_instructions":
							return `[${block.name} for '${block.params.task}']`
						case "write_to_file":
							return `[${block.name} for '${block.params.path}']`
						case "apply_diff":
							return `[${block.name} for '${block.params.path}']`
						case "search_files":
							return `[${block.name} for '${block.params.regex}'${
								block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
							}]`
						case "insert_content":
							return `[${block.name} for '${block.params.path}']`
						case "search_and_replace":
							return `[${block.name} for '${block.params.path}']`
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
						case "attempt_completion":
							return `[${block.name}]`
						case "switch_mode":
							return `[${block.name} to '${block.params.mode_slug}'${block.params.reason ? ` because: ${block.params.reason}` : ""}]`
						case "new_task": {
							const mode = block.params.mode ?? defaultModeSlug
							const message = block.params.message ?? "(no message)"
							const modeName = getModeBySlug(mode, customModes)?.name ?? mode
							return `[${block.name} in ${modeName} mode: '${message}']`
						}
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
					// once a tool result has been collected, ignore all other tool uses since we should only ever present one tool result per message
					this.didAlreadyUseTool = true

					// Flag a checkpoint as possible since we've used a tool
					// which may have changed the file system.
				}

				const askApproval = async (
					type: ClineAsk,
					partialMessage?: string,
					progressStatus?: ToolProgressStatus,
				) => {
					const { response, text, images } = await this.ask(type, partialMessage, false, progressStatus)
					if (response !== "yesButtonClicked") {
						// Handle both messageResponse and noButtonClicked with text
						if (text) {
							await this.say("user_feedback", text, images)
							pushToolResult(
								formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images),
							)
						} else {
							pushToolResult(formatResponse.toolDenied())
						}
						this.didRejectTool = true
						return false
					}
					// Handle yesButtonClicked with text
					if (text) {
						await this.say("user_feedback", text, images)
						pushToolResult(formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(text), images))
					}
					return true
				}

				const askFinishSubTaskApproval = async () => {
					// ask the user to approve this task has completed, and he has reviewd it, and we can declare task is finished
					// and return control to the parent task to continue running the rest of the sub-tasks
					const toolMessage = JSON.stringify({
						tool: "finishTask",
					})

					return await askApproval("tool", toolMessage)
				}

				const handleError = async (action: string, error: Error) => {
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

				// If block is partial, remove partial closing tag so its not presented to user
				const removeClosingTag = (tag: ToolParamName, text?: string): string => {
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

				if (!block.partial) {
					this.recordToolUsage(block.name)
					telemetryService.captureToolUsage(this.taskId, block.name)
				}

				// Validate tool use before execution
				const { mode, customModes } = (await this.providerRef.deref()?.getState()) ?? {}
				try {
					validateToolUse(
						block.name as ToolName,
						mode ?? defaultModeSlug,
						customModes ?? [],
						{
							apply_diff: this.diffEnabled,
						},
						block.params,
					)
				} catch (error) {
					this.consecutiveMistakeCount++
					pushToolResult(formatResponse.toolError(error.message))
					break
				}

				// Check for identical consecutive tool calls
				if (!block.partial) {
					// Use the detector to check for repetition, passing the ToolUse block directly
					const repetitionCheck = this.toolRepetitionDetector.check(block)

					// If execution is not allowed, notify user and break
					if (!repetitionCheck.allowExecution && repetitionCheck.askUser) {
						// Handle repetition similar to mistake_limit_reached pattern
						const { response, text, images } = await this.ask(
							repetitionCheck.askUser.messageKey as ClineAsk,
							repetitionCheck.askUser.messageDetail.replace("{toolName}", block.name),
						)

						if (response === "messageResponse") {
							// Add user feedback to userContent
							this.userMessageContent.push(
								{
									type: "text" as const,
									text: `Tool repetition limit reached. User feedback: ${text}`,
								},
								...formatResponse.imageBlocks(images),
							)

							// Add user feedback to chat
							await this.say("user_feedback", text, images)

							// Track tool repetition in telemetry
							telemetryService.captureConsecutiveMistakeError(this.taskId) // Using existing telemetry method
						}

						// Return tool result message about the repetition
						pushToolResult(
							formatResponse.toolError(
								`Tool call repetition limit reached for ${block.name}. Please try a different approach.`,
							),
						)
						break
					}
				}

				switch (block.name) {
					case "write_to_file":
						await writeToFileTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "apply_diff":
						await applyDiffTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "insert_content":
						await insertContentTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "search_and_replace":
						await searchAndReplaceTool(
							this,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
						)
						break
					case "read_file":
						await readFileTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)

						break
					case "fetch_instructions":
						await fetchInstructionsTool(this, block, askApproval, handleError, pushToolResult)
						break
					case "list_files":
						await listFilesTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "list_code_definition_names":
						await listCodeDefinitionNamesTool(
							this,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
						)
						break
					case "search_files":
						await searchFilesTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "browser_action":
						await browserActionTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "execute_command":
						await executeCommandTool(
							this,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
						)
						break
					case "use_mcp_tool":
						await useMcpToolTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "access_mcp_resource":
						await accessMcpResourceTool(
							this,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
						)
						break
					case "ask_followup_question":
						await askFollowupQuestionTool(
							this,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
						)
						break
					case "switch_mode":
						await switchModeTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "new_task":
						await newTaskTool(this, block, askApproval, handleError, pushToolResult, removeClosingTag)
						break
					case "attempt_completion":
						await attemptCompletionTool(
							this,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolDescription,
							askFinishSubTaskApproval,
						)
						break
				}

				break
		}

		const recentlyModifiedFiles = this.fileContextTracker.getAndClearCheckpointPossibleFile()

		if (recentlyModifiedFiles.length > 0) {
			// TODO: We can track what file changes were made and only
			// checkpoint those files, this will be save storage.
			await this.checkpointSave()
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
				// its okay that we increment if !didCompleteReadingStream, it'll just return bc out of bounds and as streaming continues it will call presentAssitantMessage if a new block is ready. if streaming is finished then we set userMessageContentReady to true when out of bounds. This gracefully allows the stream to continue on and all potential content blocks be presented.
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

	// Transform

	public async parseUserContent(userContent: UserContent) {
		// Process userContent array, which contains various block types:
		// TextBlockParam, ImageBlockParam, ToolUseBlockParam, and ToolResultBlockParam.
		// We need to apply parseMentions() to:
		// 1. All TextBlockParam's text (first user message with task)
		// 2. ToolResultBlockParam's content/context text arrays if it contains
		// "<feedback>" (see formatToolDeniedFeedback, attemptCompletion,
		// executeCommand, and consecutiveMistakeCount >= 3) or "<answer>"
		// (see askFollowupQuestion), we place all user generated content in
		// these tags so they can effectively be used as markers for when we
		// should parse mentions).
		return Promise.all(
			userContent.map(async (block) => {
				const shouldProcessMentions = (text: string) => text.includes("<task>") || text.includes("<feedback>")

				if (block.type === "text") {
					if (shouldProcessMentions(block.text)) {
						return {
							...block,
							text: await parseMentions(
								block.text,
								this.cwd,
								this.urlContentFetcher,
								this.fileContextTracker,
							),
						}
					}

					return block
				} else if (block.type === "tool_result") {
					if (typeof block.content === "string") {
						if (shouldProcessMentions(block.content)) {
							return {
								...block,
								content: await parseMentions(
									block.content,
									this.cwd,
									this.urlContentFetcher,
									this.fileContextTracker,
								),
							}
						}

						return block
					} else if (Array.isArray(block.content)) {
						const parsedContent = await Promise.all(
							block.content.map(async (contentBlock) => {
								if (contentBlock.type === "text" && shouldProcessMentions(contentBlock.text)) {
									return {
										...contentBlock,
										text: await parseMentions(
											contentBlock.text,
											this.cwd,
											this.urlContentFetcher,
											this.fileContextTracker,
										),
									}
								}

								return contentBlock
							}),
						)

						return { ...block, content: parsedContent }
					}

					return block
				}

				return block
			}),
		)
	}

	// Checkpoints

	private getCheckpointService() {
		if (!this.enableCheckpoints) {
			return undefined
		}

		if (this.checkpointService) {
			return this.checkpointService
		}

		if (this.checkpointServiceInitializing) {
			console.log("[Cline#getCheckpointService] checkpoint service is still initializing")
			return undefined
		}

		const log = (message: string) => {
			console.log(message)

			try {
				this.providerRef.deref()?.log(message)
			} catch (err) {
				// NO-OP
			}
		}

		console.log("[Cline#getCheckpointService] initializing checkpoints service")

		try {
			const workspaceDir = getWorkspacePath()

			if (!workspaceDir) {
				log("[Cline#getCheckpointService] workspace folder not found, disabling checkpoints")
				this.enableCheckpoints = false
				return undefined
			}

			const globalStorageDir = this.providerRef.deref()?.context.globalStorageUri.fsPath

			if (!globalStorageDir) {
				log("[Cline#getCheckpointService] globalStorageDir not found, disabling checkpoints")
				this.enableCheckpoints = false
				return undefined
			}

			const options: CheckpointServiceOptions = {
				taskId: this.taskId,
				workspaceDir,
				shadowDir: globalStorageDir,
				log,
			}

			const service = RepoPerTaskCheckpointService.create(options)

			this.checkpointServiceInitializing = true

			service.on("initialize", () => {
				log("[Cline#getCheckpointService] service initialized")

				try {
					const isCheckpointNeeded =
						typeof this.clineMessages.find(({ say }) => say === "checkpoint_saved") === "undefined"

					this.checkpointService = service
					this.checkpointServiceInitializing = false

					if (isCheckpointNeeded) {
						log("[Cline#getCheckpointService] no checkpoints found, saving initial checkpoint")
						this.checkpointSave()
					}
				} catch (err) {
					log("[Cline#getCheckpointService] caught error in on('initialize'), disabling checkpoints")
					this.enableCheckpoints = false
				}
			})

			service.on("checkpoint", ({ isFirst, fromHash: from, toHash: to }) => {
				try {
					this.providerRef.deref()?.postMessageToWebview({ type: "currentCheckpointUpdated", text: to })

					this.say("checkpoint_saved", to, undefined, undefined, { isFirst, from, to }).catch((err) => {
						log("[Cline#getCheckpointService] caught unexpected error in say('checkpoint_saved')")
						console.error(err)
					})
				} catch (err) {
					log(
						"[Cline#getCheckpointService] caught unexpected error in on('checkpoint'), disabling checkpoints",
					)
					console.error(err)
					this.enableCheckpoints = false
				}
			})

			log("[Cline#getCheckpointService] initializing shadow git")

			service.initShadowGit().catch((err) => {
				log(
					`[Cline#getCheckpointService] caught unexpected error in initShadowGit, disabling checkpoints (${err.message})`,
				)
				console.error(err)
				this.enableCheckpoints = false
			})

			return service
		} catch (err) {
			log("[Cline#getCheckpointService] caught unexpected error, disabling checkpoints")
			this.enableCheckpoints = false
			return undefined
		}
	}

	private async getInitializedCheckpointService({
		interval = 250,
		timeout = 15_000,
	}: { interval?: number; timeout?: number } = {}) {
		const service = this.getCheckpointService()

		if (!service || service.isInitialized) {
			return service
		}

		try {
			await pWaitFor(
				() => {
					console.log("[Cline#getCheckpointService] waiting for service to initialize")
					return service.isInitialized
				},
				{ interval, timeout },
			)

			return service
		} catch (err) {
			return undefined
		}
	}

	public async checkpointDiff({
		ts,
		previousCommitHash,
		commitHash,
		mode,
	}: {
		ts: number
		previousCommitHash?: string
		commitHash: string
		mode: "full" | "checkpoint"
	}) {
		const service = await this.getInitializedCheckpointService()

		if (!service) {
			return
		}

		telemetryService.captureCheckpointDiffed(this.taskId)

		if (!previousCommitHash && mode === "checkpoint") {
			const previousCheckpoint = this.clineMessages
				.filter(({ say }) => say === "checkpoint_saved")
				.sort((a, b) => b.ts - a.ts)
				.find((message) => message.ts < ts)

			previousCommitHash = previousCheckpoint?.text
		}

		try {
			const changes = await service.getDiff({ from: previousCommitHash, to: commitHash })

			if (!changes?.length) {
				vscode.window.showInformationMessage("No changes found.")
				return
			}

			await vscode.commands.executeCommand(
				"vscode.changes",
				mode === "full" ? "Changes since task started" : "Changes since previous checkpoint",
				changes.map((change) => [
					vscode.Uri.file(change.paths.absolute),
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
						query: Buffer.from(change.content.before ?? "").toString("base64"),
					}),
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
						query: Buffer.from(change.content.after ?? "").toString("base64"),
					}),
				]),
			)
		} catch (err) {
			this.providerRef.deref()?.log("[checkpointDiff] disabling checkpoints for this task")
			this.enableCheckpoints = false
		}
	}

	public async checkpointSave() {
		const service = this.getCheckpointService()

		if (!service) {
			return
		}

		if (!service.isInitialized) {
			this.providerRef
				.deref()
				?.log("[checkpointSave] checkpoints didn't initialize in time, disabling checkpoints for this task")

			this.enableCheckpoints = false
			return
		}

		telemetryService.captureCheckpointCreated(this.taskId)

		// Start the checkpoint process in the background.
		return service.saveCheckpoint(`Task: ${this.taskId}, Time: ${Date.now()}`).catch((err) => {
			console.error("[Cline#checkpointSave] caught unexpected error, disabling checkpoints", err)
			this.enableCheckpoints = false
		})
	}

	public async checkpointRestore({
		ts,
		commitHash,
		mode,
	}: {
		ts: number
		commitHash: string
		mode: "preview" | "restore"
	}) {
		const service = await this.getInitializedCheckpointService()

		if (!service) {
			return
		}

		const index = this.clineMessages.findIndex((m) => m.ts === ts)

		if (index === -1) {
			return
		}

		try {
			await service.restoreCheckpoint(commitHash)

			telemetryService.captureCheckpointRestored(this.taskId)

			await this.providerRef.deref()?.postMessageToWebview({ type: "currentCheckpointUpdated", text: commitHash })

			if (mode === "restore") {
				await this.overwriteApiConversationHistory(
					this.apiConversationHistory.filter((m) => !m.ts || m.ts < ts),
				)

				const deletedMessages = this.clineMessages.slice(index + 1)

				const { totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost } = getApiMetrics(
					combineApiRequests(combineCommandSequences(deletedMessages)),
				)

				await this.overwriteClineMessages(this.clineMessages.slice(0, index + 1))

				// TODO: Verify that this is working as expected.
				await this.say(
					"api_req_deleted",
					JSON.stringify({
						tokensIn: totalTokensIn,
						tokensOut: totalTokensOut,
						cacheWrites: totalCacheWrites,
						cacheReads: totalCacheReads,
						cost: totalCost,
					} satisfies ClineApiReqInfo),
				)
			}

			// The task is already cancelled by the provider beforehand, but we
			// need to re-init to get the updated messages.
			//
			// This was take from Cline's implementation of the checkpoints
			// feature. The cline instance will hang if we don't cancel twice,
			// so this is currently necessary, but it seems like a complicated
			// and hacky solution to a problem that I don't fully understand.
			// I'd like to revisit this in the future and try to improve the
			// task flow and the communication between the webview and the
			// Cline instance.
			this.providerRef.deref()?.cancelTask()
		} catch (err) {
			this.providerRef.deref()?.log("[checkpointRestore] disabling checkpoints for this task")
			this.enableCheckpoints = false
		}
	}

	// Metrics

	public getTokenUsage() {
		return getApiMetrics(combineApiRequests(combineCommandSequences(this.clineMessages.slice(1))))
	}

	public recordToolUsage(toolName: ToolName) {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}

		this.toolUsage[toolName].attempts++
	}

	public recordToolError(toolName: ToolName, error?: string) {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}

		this.toolUsage[toolName].failures++

		if (error) {
			this.emit("taskToolFailed", this.taskId, toolName, error)
		}
	}

	public getToolUsage() {
		return this.toolUsage
	}

	// Getters

	public get cwd() {
		return this.workspacePath
	}

	public getFileContextTracker(): FileContextTracker {
		return this.fileContextTracker
	}
}
