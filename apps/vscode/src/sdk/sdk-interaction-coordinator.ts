import type { ClineAskQuestion, ClineMessage } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger"
import { MessageIdMinter } from "./message-id-minter"
import { buildToolApprovalAskMessage } from "./message-translator"
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
	shouldAutoApproveTool?: (request: ToolApprovalRequest) => boolean
	/**
	 * The process-wide id/seq/epoch authority, shared with the message translator. Optional so
	 * existing tests that don't need cross-generator id uniqueness keep working; when omitted a
	 * private minter is used. Production wires the shared minter from MessageTranslatorState.
	 */
	getMinter?: () => MessageIdMinter
}

export class SdkInteractionCoordinator {
	private pendingAskResolve: ((answer: string) => void) | undefined
	private pendingToolApprovalResolve: ((result: { approved: boolean; reason?: string }) => void) | undefined

	constructor(private readonly options: SdkInteractionCoordinatorOptions) {}

	async handleRequestToolApproval(request: ToolApprovalRequest): Promise<{ approved: boolean; reason?: string }> {
		if (request.policy.autoApprove === true || this.options.shouldAutoApproveTool?.(request) === true) {
			Logger.log(`[SdkController] Auto-approving tool execution: tool=${request.toolName}`)
			return { approved: true }
		}

		const toolAskMessage: ClineMessage = buildToolApprovalAskMessage(request.toolName, request.input, this.nextMessageTs())

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

	/**
	 * Mint a unique message id from the SHARED minter so interaction messages (tool-approval
	 * asks, ask_question, user_feedback) never collide with translator-minted ids. Falls back to
	 * a private minter when none is wired (tests).
	 */
	private nextMessageTs(): number {
		return this.getMinter().nextId()
	}

	private fallbackMinter: MessageIdMinter | undefined
	private getMinter(): MessageIdMinter {
		if (this.options.getMinter) {
			return this.options.getMinter()
		}
		if (!this.fallbackMinter) {
			// Lazy import-free fallback: construct on first use.
			this.fallbackMinter = new MessageIdMinter()
		}
		return this.fallbackMinter
	}
}
