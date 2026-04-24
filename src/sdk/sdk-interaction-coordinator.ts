import type { ClineAskQuestion, ClineMessage } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger"
import { sdkToolToClineSayTool } from "./message-translator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"

export interface ToolApprovalRequest {
	agentId: string
	conversationId: string
	iteration: number
	toolCallId: string
	toolName: string
	input: unknown
	policy: { enabled?: boolean; autoApprove?: boolean }
}

export interface SdkInteractionCoordinatorOptions {
	messages: SdkMessageCoordinator
	getSessionId: () => string
	postStateToWebview: () => Promise<void>
}

export class SdkInteractionCoordinator {
	private pendingAskResolve: ((answer: string) => void) | undefined
	private pendingToolApprovalResolve: ((result: { approved: boolean; reason?: string }) => void) | undefined
	private lastInteractionMessageTs = 0

	constructor(private readonly options: SdkInteractionCoordinatorOptions) {}

	async handleRequestToolApproval(request: ToolApprovalRequest): Promise<{ approved: boolean; reason?: string }> {
		const sayTool = sdkToolToClineSayTool(request.toolName, request.input)
		const toolAskMessage: ClineMessage = {
			ts: this.nextMessageTs(),
			type: "ask",
			ask: "tool",
			text: JSON.stringify(sayTool),
			partial: false,
		}

		this.options.messages.appendAndEmit([toolAskMessage], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		await this.options.postStateToWebview()

		return new Promise<{ approved: boolean; reason?: string }>((resolve) => {
			this.pendingToolApprovalResolve = resolve
		})
	}

	async handleAskQuestion(question: string, options: string[], _context: unknown): Promise<string> {
		const askData: ClineAskQuestion = {
			question,
			options: options?.length ? options : undefined,
		}
		const askMessage: ClineMessage = {
			ts: this.nextMessageTs(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify(askData),
			partial: false,
		}

		this.options.messages.appendAndEmit([askMessage], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		await this.options.postStateToWebview()

		return new Promise<string>((resolve) => {
			this.pendingAskResolve = resolve
		})
	}

	resolvePendingToolApproval(prompt: string | undefined, responseType: ClineAskResponse | undefined): boolean {
		if (!this.pendingToolApprovalResolve) {
			return false
		}

		const resolve = this.pendingToolApprovalResolve
		this.pendingToolApprovalResolve = undefined
		const approved = responseType === "yesButtonClicked"
		Logger.log(`[SdkController] Resolving pending tool approval: approved=${approved} (responseType=${responseType})`)

		resolve({
			approved,
			...(approved ? {} : { reason: prompt || "User denied the tool execution" }),
		})
		return true
	}

	resolvePendingAskQuestion(prompt: string | undefined): boolean {
		if (!this.pendingAskResolve) {
			return false
		}

		const resolve = this.pendingAskResolve
		this.pendingAskResolve = undefined
		const responseText = prompt ?? ""
		Logger.log(`[SdkController] Resolving pending ask_question with: "${responseText.substring(0, 80)}"`)

		if (responseText) {
			const userMessage: ClineMessage = {
				ts: this.nextMessageTs(),
				type: "say",
				say: "user_feedback",
				text: responseText,
				partial: false,
			}
			this.options.messages.appendAndEmit([userMessage], {
				type: "status",
				payload: { sessionId: this.options.getSessionId(), status: "running" },
			})
		}

		resolve(responseText)
		return true
	}

	clearPending(reason: string): void {
		this.pendingAskResolve = undefined
		if (this.pendingToolApprovalResolve) {
			this.pendingToolApprovalResolve({ approved: false, reason })
			this.pendingToolApprovalResolve = undefined
		}
	}

	private nextMessageTs(): number {
		const now = Date.now()
		this.lastInteractionMessageTs = Math.max(now, this.lastInteractionMessageTs + 1)
		return this.lastInteractionMessageTs
	}
}
