import { Anthropic } from "@anthropic-ai/sdk"
import cloneDeep from "clone-deep"
import delay from "delay"
import fs from "fs/promises"
import os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { ApiHandler, buildApiHandler } from "../api"
import { ApiStream } from "../api/transform/stream"
import { DiffViewProvider } from "../integrations/editor/DiffViewProvider"
import { findToolName, formatContentBlockToMarkdown } from "../integrations/misc/export-markdown"
import { extractTextFromFile } from "../integrations/misc/extract-text"
import { TerminalManager } from "../integrations/terminal/TerminalManager"
import { BrowserSession } from "../services/browser/BrowserSession"
import { UrlContentFetcher } from "../services/browser/UrlContentFetcher"
import { listFiles } from "../services/glob/list-files"
import { regexSearchFiles } from "../services/ripgrep"
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter"
import { ApiConfiguration } from "../shared/api"
import { findLastIndex } from "../shared/array"
import { AutoApprovalSettings } from "../shared/AutoApprovalSettings"
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
} from "../shared/ExtensionMessage"
import { getApiMetrics } from "../shared/getApiMetrics"
import { HistoryItem } from "../shared/HistoryItem"
import { ClineAskResponse } from "../shared/WebviewMessage"
import { calculateApiCost } from "../utils/cost"
import { fileExistsAtPath } from "../utils/fs"
import { arePathsEqual, getReadablePath } from "../utils/path"
import { AssistantMessageContent, parseAssistantMessage, ToolParamName, ToolUseName } from "./assistant-message"
import { constructNewFileContent } from "./assistant-message/diff"
import { parseMentions } from "./mentions"
import { formatResponse } from "./prompts/responses"
import { addUserInstructions, SYSTEM_PROMPT } from "./prompts/system"
import { truncateHalfConversation } from "./sliding-window"
import { ClineProvider, GlobalFileNames } from "./webview/ClineProvider"
import { showSystemNotification } from "../integrations/notifications"
import { removeInvalidChars } from "../utils/string"
import { fixModelHtmlEscaping } from "../utils/string"
import { OpenAiHandler } from "../api/providers/openai"

const cwd =
	vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop") // may or may not exist but fs checking existence would immediately ask for permission which would be bad UX, need to come up with a better solution

type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>
type UserContent = Array<
	Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
>

export class Cline {
	readonly taskId: string
	api: ApiHandler
	private terminalManager: TerminalManager
	private urlContentFetcher: UrlContentFetcher
	private browserSession: BrowserSession
	private didEditFile: boolean = false
	customInstructions?: string
	autoApprovalSettings: AutoApprovalSettings
	apiConversationHistory: Anthropic.MessageParam[] = []
	clineMessages: ClineMessage[] = []
	private askResponse?: ClineAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	private lastMessageTs?: number
	private consecutiveAutoApprovedRequestsCount: number = 0
	private consecutiveMistakeCount: number = 0
	private providerRef: WeakRef<ClineProvider>
	private abort: boolean = false
	didFinishAborting = false
	abandoned = false
	private diffViewProvider: DiffViewProvider

	// streaming
	private currentStreamingContentIndex = 0
	private assistantMessageContent: AssistantMessageContent[] = []
	private presentAssistantMessageLocked = false
	private presentAssistantMessageHasPendingUpdates = false
	private userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
	private userMessageContentReady = false
	private didRejectTool = false
	private didAlreadyUseTool = false
	private didCompleteReadingStream = false

	constructor(
		provider: ClineProvider,
		apiConfiguration: ApiConfiguration,
		autoApprovalSettings: AutoApprovalSettings,
		customInstructions?: string,
		task?: string,
		images?: string[],
		historyItem?: HistoryItem,
	) {
		this.providerRef = new WeakRef(provider)
		this.api = buildApiHandler(apiConfiguration)
		this.terminalManager = new TerminalManager()
		this.urlContentFetcher = new UrlContentFetcher(provider.context)
		this.browserSession = new BrowserSession(provider.context)
		this.diffViewProvider = new DiffViewProvider(cwd)
		this.customInstructions = customInstructions
		this.autoApprovalSettings = autoApprovalSettings
		if (historyItem) {
			this.taskId = historyItem.id
			this.resumeTaskFromHistory()
		} else if (task || images) {
			this.taskId = Date.now().toString()
			this.startTask(task, images)
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}
	}

	// Storing task to disk for history

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
			// in the off chance this fails, we don't want to stop the task
			console.error("Failed to save API conversation history:", error)
		}
	}

	private async getSavedClineMessages(): Promise<ClineMessage[]> {
		const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.uiMessages)
		if (await fileExistsAtPath(filePath)) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		} else {
			// check old location
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
		this.clineMessages.push(message)
		await this.saveClineMessages()
	}

	private async overwriteClineMessages(newMessages: ClineMessage[]) {
		this.clineMessages = newMessages
		await this.saveClineMessages()
	}

	private async saveClineMessages() {
		try {
			const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.uiMessages)
			await fs.writeFile(filePath, JSON.stringify(this.clineMessages))
			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.clineMessages.slice(1))))
			const taskMessage = this.clineMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.clineMessages[
					findLastIndex(
						this.clineMessages,
						(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
					)
				]
			await this.providerRef.deref()?.updateTaskHistory({
				id: this.taskId,
				ts: lastRelevantMessage.ts,
				task: taskMessage.text ?? "",
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
			})
		} catch (error) {
			console.error("Failed to save cline messages:", error)
		}
	}

	// Communicate with webview

	// partial has three valid states true (partial message), false (completion of partial message), undefined (individual complete message)
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
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
					// await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
					throw new Error("Current ask promise was ignored 1")
				} else {
					// this is a new partial message, so add it with partial state
					// this.askResponse = undefined
					// this.askResponseText = undefined
					// this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, partial })
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
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
				} else {
					// this is a new partial=false message, so add it like normal
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text })
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
			await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text })
			await this.providerRef.deref()?.postStateToWebview()
		}

		await pWaitFor(() => this.askResponse !== undefined || this.lastMessageTs !== askTs, { interval: 100 })
		if (this.lastMessageTs !== askTs) {
			throw new Error("Current ask promise was ignored") // could happen if we send multiple asks in a row i.e. with command_output. It's important that when we know an ask could fail, it is handled gracefully
		}
		const result = { response: this.askResponse!, text: this.askResponseText, images: this.askResponseImages }
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

	async say(type: ClineSay, text?: string, images?: string[], partial?: boolean): Promise<undefined> {
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
					lastMessage.partial = partial
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
				} else {
					// this is a new partial message, so add it with partial state
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images, partial })
					await this.providerRef.deref()?.postStateToWebview()
				}
			} else {
				// partial=false means its a complete version of a previously partial message
				if (isUpdatingPreviousPartial) {
					// this is the complete version of a previously partial message, so replace the partial with the complete version
					this.lastMessageTs = lastMessage.ts
					// lastMessage.ts = sayTs
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = false

					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage }) // more performant than an entire postStateToWebview
				} else {
					// this is a new partial=false message, so add it like normal
					const sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images })
					await this.providerRef.deref()?.postStateToWebview()
				}
			}
		} else {
			// this is a new non-partial message, so add it like normal
			const sayTs = Date.now()
			this.lastMessageTs = sayTs
			await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images })
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
		if (
			lastMessage?.partial &&
			lastMessage.type === type &&
			(lastMessage.ask === askOrSay || lastMessage.say === askOrSay)
		) {
			this.clineMessages.pop()
			await this.saveClineMessages()
			await this.providerRef.deref()?.postStateToWebview()
		}
	}

	// Task lifecycle

	private async startTask(task?: string, images?: string[]): Promise<void> {
		// conversationHistory (for API) and clineMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the clineMessages might not be empty, so we need to set it to [] when we create a new Cline client (otherwise webview would show stale messages from previous session)
		this.clineMessages = []
		this.apiConversationHistory = []
		await this.providerRef.deref()?.postStateToWebview()

		await this.say("text", task, images)

		let imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)
		await this.initiateTaskLoop([
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		])
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

		// Now present the cline messages to the user and ask if they want to resume

		const lastClineMessage = this.clineMessages
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // could be multiple resume tasks
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

		const { response, text, images } = await this.ask(askType) // calls poststatetowebview
		let responseText: string | undefined
		let responseImages: string[] | undefined
		if (response === "messageResponse") {
			await this.say("user_feedback", text, images)
			responseText = text
			responseImages = images
		}

		// need to make sure that the api conversation history can be resumed by the api, even if it goes out of sync with cline messages

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
				`[TASK RESUMPTION] This task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '${cwd.toPosix()}'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.${
					wasRecent
						? "\n\nIMPORTANT: If the last tool use was a replace_in_file or write_to_file that was interrupted, the file was reverted back to its original state before the interrupted edit, and you do NOT need to re-read the file as you already have its up-to-date contents."
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

	abortTask() {
		this.abort = true // will stop any autonomously running promises
		this.terminalManager.disposeAll()
		this.urlContentFetcher.closeBrowser()
		this.browserSession.closeBrowser()
		this.diffViewProvider.revertChanges()
	}

	// Tools

	async executeCommandTool(command: string): Promise<[boolean, ToolResponse]> {
		const terminalInfo = await this.terminalManager.getOrCreateTerminal(cwd)
		terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
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
				process.continue() // continue past the await
			} catch {
				// This can only happen if this ask promise was ignored, so ignore this error
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

		// Wait for a short delay to ensure all messages are sent to the webview
		// This delay allows time for non-awaited promises to be created and
		// for their associated messages to be sent to the webview, maintaining
		// the correct order of messages (although the webview is smart about
		// grouping command_output messages despite any gaps anyways)
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

	async *attemptApiRequest(previousApiReqIndex: number): ApiStream {
		// Wait for MCP servers to be connected before generating system prompt
		await pWaitFor(() => this.providerRef.deref()?.mcpHub?.isConnecting !== true, { timeout: 10_000 }).catch(() => {
			console.error("MCP servers failed to connect in time")
		})

		const mcpHub = this.providerRef.deref()?.mcpHub
		if (!mcpHub) {
			throw new Error("MCP hub not available")
		}

		let systemPrompt = await SYSTEM_PROMPT(cwd, this.api.getModel().info.supportsComputerUse ?? false, mcpHub)
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
			// altering the system prompt mid-task will break the prompt cache, but in the grand scheme this will not change often so it's better to not pollute user messages with it the way we have to with <potentially relevant details>
			systemPrompt += addUserInstructions(settingsCustomInstructions, clineRulesFileInstructions)
		}

		// If the previous API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
		if (previousApiReqIndex >= 0) {
			const previousRequest = this.clineMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(
					previousRequest.text,
				)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				let contextWindow = this.api.getModel().info.contextWindow || 128_000
				// FIXME: hack to get anyone using openai compatible with deepseek to have the proper context window instead of the default 128k. We need a way for the user to specify the context window for models they input through openai compatible
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

				if (totalTokens >= maxAllowedSize) {
					const truncatedMessages = truncateHalfConversation(this.apiConversationHistory)
					await this.overwriteApiConversationHistory(truncatedMessages)
				}
			}
		}

		const stream = this.api.createMessage(systemPrompt, this.apiConversationHistory)
		const iterator = stream[Symbol.asyncIterator]()

		try {
			// awaiting first chunk to see if it will throw an error
			const firstChunk = await iterator.next()
			yield firstChunk.value
		} catch (error) {
			// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.
			const { response } = await this.ask(
				"api_req_failed",
				error.message ?? JSON.stringify(serializeError(error), null, 2),
			)
			if (response !== "yesButtonClicked") {
				// this will never happen since if noButtonClicked, we will clear current task, aborting this instance
				throw new Error("API request failed")
			}
			await this.say("api_req_retried")
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
						case "attempt_completion":
							return `[${block.name}]`
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
				}

				const askApproval = async (type: ClineAsk, partialMessage?: string) => {
					const { response, text, images } = await this.ask(type, partialMessage, false)
					if (response !== "yesButtonClicked") {
						if (response === "messageResponse") {
							await this.say("user_feedback", text, images)
							pushToolResult(
								formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images),
							)
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
							}

							if (block.partial) {
								// update gui message
								const partialMessage = JSON.stringify(sharedMessageProps)
								if (this.shouldAutoApproveTool(block.name)) {
									this.removeLastPartialMessageIfExistsWithType("ask", "tool") // in case the user changes auto-approval settings mid stream
									await this.say("tool", partialMessage, undefined, block.partial)
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
									break
								}
								if (block.name === "replace_in_file" && !diff) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("replace_in_file", "diff"))
									await this.diffViewProvider.reset()
									break
								}
								if (block.name === "write_to_file" && !content) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("write_to_file", "content"))
									await this.diffViewProvider.reset()
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

									// we need an artificial delay to let the diagnostics catch up to the changes
									await delay(3_500)
								} else {
									// If auto-approval is enabled but this tool wasn't auto-approved, send notification
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									// const didApprove = await askApproval("tool", completeMessage)

									// Need a more customized tool response for file edits to highlight the fact that the file was not updated (particularly important for deepseek)
									let didApprove = true
									const { response, text, images } = await this.ask("tool", completeMessage, false)
									if (response !== "yesButtonClicked") {
										// TODO: add similar context for other tool denial responses, to emphasize ie that a command was not run
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
										break
									}
								}

								const { newProblemsMessage, userEdits, autoFormattingEdits, finalContent } =
									await this.diffViewProvider.saveChanges()
								this.didEditFile = true // used to determine if we should wait for busy terminal to update before sending api request
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
								break
							}
						} catch (error) {
							await handleError("writing file", error)
							await this.diffViewProvider.revertChanges()
							await this.diffViewProvider.reset()
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
									await this.say("tool", completeMessage, undefined, false) // need to be sending partialValue bool, since undefined has its own purpose in that the message is treated neither as a partial or completion of a partial, but as a single complete message
									this.consecutiveAutoApprovedRequestsCount++
								} else {
									showNotificationForApprovalIfAutoApprovalEnabled(
										`Cline wants to read ${path.basename(absolutePath)}`,
									)
									this.removeLastPartialMessageIfExistsWithType("say", "tool")
									const didApprove = await askApproval("tool", completeMessage)
									if (!didApprove) {
										break
									}
								}
								// now execute the tool like normal
								const content = await extractTextFromFile(absolutePath)
								pushToolResult(content)
								break
							}
						} catch (error) {
							await handleError("reading file", error)
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
										break
									}
								}
								pushToolResult(result)
								break
							}
						} catch (error) {
							await handleError("listing files", error)
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
									pushToolResult(
										await this.sayAndCreateMissingParamError("list_code_definition_names", "path"),
									)
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
										break
									}
								}
								pushToolResult(result)
								break
							}
						} catch (error) {
							await handleError("parsing source code definitions", error)
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
									break
								}
								if (!regex) {
									this.consecutiveMistakeCount++
									pushToolResult(await this.sayAndCreateMissingParamError("search_files", "regex"))
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
										break
									}
								}
								pushToolResult(results)
								break
							}
						} catch (error) {
							await handleError("searching files", error)
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
										pushToolResult(
											await this.sayAndCreateMissingParamError("browser_action", "url"),
										)
										await this.browserSession.closeBrowser()
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
												await this.sayAndCreateMissingParamError(
													"browser_action",
													"coordinate",
												),
											)
											await this.browserSession.closeBrowser()
											break // can't be within an inner switch
										}
									}
									if (action === "type") {
										if (!text) {
											this.consecutiveMistakeCount++
											pushToolResult(
												await this.sayAndCreateMissingParamError("browser_action", "text"),
											)
											await this.browserSession.closeBrowser()
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
										break
									case "close":
										pushToolResult(
											formatResponse.toolResult(
												`The browser has been closed. You may now proceed to using other tools.`,
											),
										)
										break
								}
								break
							}
						} catch (error) {
							await this.browserSession.closeBrowser() // if any error occurs, the browser session is terminated
							await handleError("executing browser action", error)
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
									await this.ask(
										"command",
										removeClosingTag("command", command),
										block.partial,
									).catch(() => {})
								}
								break
							} else {
								if (!command) {
									this.consecutiveMistakeCount++
									pushToolResult(
										await this.sayAndCreateMissingParamError("execute_command", "command"),
									)
									break
								}
								if (!requiresApprovalRaw) {
									this.consecutiveMistakeCount++
									pushToolResult(
										await this.sayAndCreateMissingParamError(
											"execute_command",
											"requires_approval",
										),
									)
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
								break
							}
						} catch (error) {
							await handleError("executing command", error)
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
									pushToolResult(
										await this.sayAndCreateMissingParamError("use_mcp_tool", "server_name"),
									)
									break
								}
								if (!tool_name) {
									this.consecutiveMistakeCount++
									pushToolResult(
										await this.sayAndCreateMissingParamError("use_mcp_tool", "tool_name"),
									)
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

								if (this.shouldAutoApproveTool(block.name)) {
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
								break
							}
						} catch (error) {
							await handleError("executing MCP tool", error)
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
									pushToolResult(
										await this.sayAndCreateMissingParamError("access_mcp_resource", "server_name"),
									)
									break
								}
								if (!uri) {
									this.consecutiveMistakeCount++
									pushToolResult(
										await this.sayAndCreateMissingParamError("access_mcp_resource", "uri"),
									)
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
										break
									}
								}

								// now execute the tool
								await this.say("mcp_server_request_started")
								const resourceResult = await this.providerRef
									.deref()
									?.mcpHub?.readResource(server_name, uri)
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
								break
							}
						} catch (error) {
							await handleError("accessing MCP resource", error)
							break
						}
					}
					case "ask_followup_question": {
						const question: string | undefined = block.params.question
						try {
							if (block.partial) {
								await this.ask("followup", removeClosingTag("question", question), block.partial).catch(
									() => {},
								)
								break
							} else {
								if (!question) {
									this.consecutiveMistakeCount++
									pushToolResult(
										await this.sayAndCreateMissingParamError("ask_followup_question", "question"),
									)
									break
								}
								this.consecutiveMistakeCount = 0

								if (
									this.autoApprovalSettings.enabled &&
									this.autoApprovalSettings.enableNotifications
								) {
									showSystemNotification({
										subtitle: "Cline has a question...",
										message: question.replace(/\n/g, " "),
									})
								}

								const { text, images } = await this.ask("followup", question, false)
								await this.say("user_feedback", text ?? "", images)
								pushToolResult(formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images))
								break
							}
						} catch (error) {
							await handleError("asking question", error)
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
										await this.ask(
											"command",
											removeClosingTag("command", command),
											block.partial,
										).catch(() => {})
									} else {
										// last message is completion_result
										// we have command string, which means we have the result as well, so finish it (doesnt have to exist yet)
										await this.say(
											"completion_result",
											removeClosingTag("result", result),
											undefined,
											false,
										)
										await this.ask(
											"command",
											removeClosingTag("command", command),
											block.partial,
										).catch(() => {})
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
									pushToolResult(
										await this.sayAndCreateMissingParamError("attempt_completion", "result"),
									)
									break
								}
								this.consecutiveMistakeCount = 0

								if (
									this.autoApprovalSettings.enabled &&
									this.autoApprovalSettings.enableNotifications
								) {
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
									}

									// complete command message
									const didApprove = await askApproval("command", command)
									if (!didApprove) {
										break
									}
									const [userRejected, execCommandResult] = await this.executeCommandTool(command!)
									if (userRejected) {
										this.didRejectTool = true
										pushToolResult(execCommandResult)
										break
									}
									// user didn't reject, but the command may have output
									commandResult = execCommandResult
								} else {
									await this.say("completion_result", result, undefined, false)
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
										toolResults.push({ type: "text", text: commandResult })
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

								break
							}
						} catch (error) {
							await handleError("attempting completion", error)
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

	async recursivelyMakeClineRequests(
		userContent: UserContent,
		includeFileDetails: boolean = false,
	): Promise<boolean> {
		if (this.abort) {
			throw new Error("Cline instance aborted")
		}

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
			// if we get past the promise it means the user approved and did not start a new task
			this.consecutiveAutoApprovedRequestsCount = 0
		}

		// get previous api req's index to check token usage and determine if we need to truncate conversation history
		const previousApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		await this.say(
			"api_req_started",
			JSON.stringify({
				request:
					userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
			}),
		)

		const [parsedUserContent, environmentDetails] = await this.loadContext(userContent, includeFileDetails)
		userContent = parsedUserContent
		// add environment details as its own text block, separate from tool results
		userContent.push({ type: "text", text: environmentDetails })

		await this.addToApiConversationHistory({ role: "user", content: userContent })

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
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

			// update api_req_started. we can't use api_req_finished anymore since it's a unique case where it could come after a streaming message (ie in the middle of being updated or executed)
			// fortunately api_req_finished was always parsed out for the gui anyways, so it remains solely for legacy purposes to keep track of prices in tasks from history
			// (it's worth removing a few months from now)
			const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				this.clineMessages[lastApiReqIndex].text = JSON.stringify({
					...JSON.parse(this.clineMessages[lastApiReqIndex].text || "{}"),
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cacheWrites: cacheWriteTokens,
					cacheReads: cacheReadTokens,
					cost:
						totalCost ??
						calculateApiCost(
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

				// update api_req_started to have cancelled and cost, so that we can display the cost of the partial stream
				updateApiReqMsg(cancelReason, streamingFailedMessage)
				await this.saveClineMessages()

				// signals to provider that it can retrieve the saved messages from disk, as abortTask can not be awaited on in nature
				this.didFinishAborting = true
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
			await this.diffViewProvider.reset()

			const stream = this.attemptApiRequest(previousApiReqIndex) // yields only if the first chunk is successful, otherwise will allow the user to retry the request (most likely due to rate limit error, which gets thrown on the first chunk)
			let assistantMessage = ""
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
							// parse raw assistant message into content blocks
							const prevLength = this.assistantMessageContent.length
							this.assistantMessageContent = parseAssistantMessage(assistantMessage)
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
						// this.userMessageContentReady = true // instead of setting this premptively, we allow the present iterator to finish and set userMessageContentReady when its ready
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
					await abortStream(
						"streaming_failed",
						error.message ?? JSON.stringify(serializeError(error), null, 2),
					)
					const history = await this.providerRef.deref()?.getTaskWithId(this.taskId)
					if (history) {
						await this.providerRef.deref()?.initClineWithHistoryItem(history.historyItem)
						// await this.providerRef.deref()?.postStateToWebview()
					}
				}
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
			// this.assistantMessageContent.forEach((e) => (e.partial = false)) // cant just do this bc a tool could be in the middle of executing ()
			if (partialBlocks.length > 0) {
				this.presentAssistantMessage() // if there is content to update then it will complete and update this.userMessageContentReady to true, which we pwaitfor before making the next request. all this is really doing is presenting the last partial message that we just set to complete
			}

			updateApiReqMsg()
			await this.saveClineMessages()
			await this.providerRef.deref()?.postStateToWebview()

			// now add to apiconversationhistory
			// need to save assistant responses to file before proceeding to tool use since user can exit at any moment and we wouldn't be able to save the assistant's response
			let didEndLoop = false
			if (assistantMessage.length > 0) {
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
					content: [{ type: "text", text: "Failure: I did not provide a response." }],
				})
			}

			return didEndLoop // will always be false for now
		} catch (error) {
			// this should never happen since the only thing that can throw an error is the attemptApiRequest, which is wrapped in a try catch that sends an ask where if noButtonClicked, will clear current task and destroy this instance. However to avoid unhandled promise rejection, we will end this loop which will end execution of this instance (see startTask)
			return true // needs to be true so parent loop knows to end task
		}
	}

	async loadContext(userContent: UserContent, includeFileDetails: boolean = false) {
		return await Promise.all([
			// Process userContent array, which contains various block types:
			// TextBlockParam, ImageBlockParam, ToolUseBlockParam, and ToolResultBlockParam.
			// We need to apply parseMentions() to:
			// 1. All TextBlockParam's text (first user message with task)
			// 2. ToolResultBlockParam's content/context text arrays if it contains "<feedback>" (see formatToolDeniedFeedback, attemptCompletion, executeCommand, and consecutiveMistakeCount >= 3) or "<answer>" (see askFollowupQuestion), we place all user generated content in these tags so they can effectively be used as markers for when we should parse mentions)
			Promise.all(
				userContent.map(async (block) => {
					if (block.type === "text") {
						return {
							...block,
							text: await parseMentions(block.text, cwd, this.urlContentFetcher),
						}
					} else if (block.type === "tool_result") {
						const isUserMessage = (text: string) => text.includes("<feedback>") || text.includes("<answer>")
						if (typeof block.content === "string" && isUserMessage(block.content)) {
							return {
								...block,
								content: await parseMentions(block.content, cwd, this.urlContentFetcher),
							}
						} else if (Array.isArray(block.content)) {
							const parsedContent = await Promise.all(
								block.content.map(async (contentBlock) => {
									if (contentBlock.type === "text" && isUserMessage(contentBlock.text)) {
										return {
											...contentBlock,
											text: await parseMentions(contentBlock.text, cwd, this.urlContentFetcher),
										}
									}
									return contentBlock
								}),
							)
							return {
								...block,
								content: parsedContent,
							}
						}
					}
					return block
				}),
			),
			this.getEnvironmentDetails(includeFileDetails),
		])
	}

	async getEnvironmentDetails(includeFileDetails: boolean = false) {
		let details = ""

		// It could be useful for cline to know if the user went from one or no file to another between messages, so we always include this context
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

		return `<environment_details>\n${details.trim()}\n</environment_details>`
	}
}
