import { Anthropic } from "@anthropic-ai/sdk"
import { SidebarProvider } from "./providers/SidebarProvider"
import { ClaudeAskResponse } from "./shared/WebviewMessage"
import { ClaudeRequestResult } from "./shared/ClaudeRequestResult"
import { TaskHistoryManager } from "./HistoryManager"
import { ApiHandler } from "./ApiHandler"
import { MessageFormatter } from "./MessageFormatter"
import { ToolExecutor } from "./ToolExecutor"
import { ClaudeAsk, ClaudeSay, ClaudeMessage } from "./shared/ExtensionMessage"
import { DEFAULT_MAX_REQUESTS_PER_TASK } from "./Constants"
import pWaitFor from "p-wait-for"

export class ClaudeDev {
	private client: Anthropic
	private conversationHistory: Anthropic.MessageParam[] = []
	private maxRequestsPerTask: number
	private requestCount = 0
	private askResponse?: ClaudeAskResponse
	private askResponseText?: string
	private providerRef: WeakRef<SidebarProvider>
	abort: boolean = false
	private taskHistoryManager: TaskHistoryManager
	private currentTaskId: string | null = null
	private apiHandler: ApiHandler
	private messageFormatter: MessageFormatter
	private toolExecutor: ToolExecutor

	constructor(provider: SidebarProvider, task: string, apiKey: string, maxRequestsPerTask?: number) {
		this.providerRef = new WeakRef(provider)
		this.client = new Anthropic({ apiKey })
		this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK
		this.taskHistoryManager = new TaskHistoryManager(provider.context)
		this.messageFormatter = new MessageFormatter()
		this.toolExecutor = new ToolExecutor(this)
		this.apiHandler = new ApiHandler(this.client, this.conversationHistory, this)

		this.startTask(task)
	}

	updateApiKey(apiKey: string) {
		this.client = new Anthropic({ apiKey })
		this.apiHandler.updateClient(this.client)
	}

	updateMaxRequestsPerTask(maxRequestsPerTask: number | undefined) {
		this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK
	}

	async handleWebviewAskResponse(askResponse: ClaudeAskResponse, text?: string) {
		this.askResponse = askResponse
		this.askResponseText = text
	}

	async ask(type: ClaudeAsk, question: string): Promise<{ response: ClaudeAskResponse; text?: string }> {
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}
		this.askResponse = undefined
		this.askResponseText = undefined
		const message: ClaudeMessage = { ts: Date.now(), type: "ask", ask: type, text: question }
		await this.providerRef.deref()?.addClaudeMessage(message)
		await this.providerRef.deref()?.postStateToWebview()
		await pWaitFor(() => this.askResponse !== undefined, { interval: 100 })
		const result = { response: this.askResponse!, text: this.askResponseText }
		this.askResponse = undefined
		this.askResponseText = undefined

		this.taskHistoryManager.addMessageToTaskHistory(this.currentTaskId, message)

		return result
	}

	async say(type: ClaudeSay, text: string): Promise<undefined> {
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}
		const message: ClaudeMessage = { ts: Date.now(), type: "say", say: type, text: text }
		await this.providerRef.deref()?.addClaudeMessage(message)
		await this.providerRef.deref()?.postStateToWebview()

		this.taskHistoryManager.addMessageToTaskHistory(this.currentTaskId, message)
		return undefined
	}

	private async startTask(task: string): Promise<void> {
		await this.providerRef.deref()?.setClaudeMessages([])
		await this.providerRef.deref()?.postStateToWebview()

		const initialMessage: ClaudeMessage = { ts: Date.now(), type: "say", say: "text", text: task }
		this.currentTaskId = Date.now().toString()
		this.taskHistoryManager.addTask(task, [this.messageFormatter.formatMessageForHistory(initialMessage)])

		let userPrompt = `Task: \"${task}\"`

		await this.say("text", task)

		let totalInputTokens = 0
		let totalOutputTokens = 0

		while (this.requestCount < this.maxRequestsPerTask) {
			const { didCompleteTask, inputTokens, outputTokens } = await this.recursivelyMakeClaudeRequests([
				{ type: "text", text: userPrompt },
			])
			totalInputTokens += inputTokens
			totalOutputTokens += outputTokens

			if (didCompleteTask) {
				break
			} else {
				userPrompt =
					"Ask yourself if you have completed the user's task. If you have, use the attempt_completion tool, otherwise proceed to the next step. (This is an automated message, so do not respond to it conversationally. Just proceed with the task.)"
			}
		}

		this.currentTaskId = null
	}

	async recursivelyMakeClaudeRequests(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): Promise<ClaudeRequestResult> {
		return this.apiHandler.makeRequest(userContent, this.requestCount, this.maxRequestsPerTask, this.toolExecutor)
	}

	async loadHistoryTask(taskId: string): Promise<void> {
		const task = this.taskHistoryManager.getTaskById(taskId)
		if (task) {
			await this.providerRef
				.deref()
				?.setClaudeMessages(this.messageFormatter.convertHistoryMessagesToClaudeMessages(task.messages))
			await this.providerRef.deref()?.postStateToWebview()
		}
	}
}
