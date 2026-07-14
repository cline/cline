import type { ConsecutiveMistakeLimitContext, ConsecutiveMistakeLimitDecision } from "@cline/shared"
import type { ClineAskQuestion, ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger"
import { MessageIdMinter } from "./message-id-minter"
import { buildToolApprovalAskMessage } from "./message-translator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { buildToolApprovalDenialReason } from "./tool-approval-denial"

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
	recordApprovedToolMessage?: (toolCallId: string, messageTs: number) => void
	recordDeniedToolApproval?: (toolCallId: string, toolName: string, reason: string) => void
	/**
	 * The process-wide id/seq/epoch authority, shared with the message translator. Optional so
	 * existing tests that don't need cross-generator id uniqueness keep working; when omitted a
	 * private minter is used. Production wires the shared minter from MessageTranslatorState.
	 */
	getMinter?: () => MessageIdMinter
	/**
	 * Set the authoritative UI turn phase. Called when an approval/ask is pending
	 * (awaiting_approval / awaiting_followup) and when the user responds (back to streaming).
	 * Optional for tests.
	 */
	setTurnPhase?: (phase: TurnPhase, anchorTs?: number) => void
	/**
	 * Invoked for manually-approved tools after the auto-approve short-circuit, BEFORE the
	 * ask message is emitted. Used to open the edit diff preview so the user decides while
	 * looking at the actual change. Must not throw; failures fall back to a plain ask.
	 */
	onToolApprovalAsk?: (request: ToolApprovalRequest) => Promise<void>
}

export class SdkInteractionCoordinator {
	private pendingAskResolve: ((answer: string) => void) | undefined
	private pendingToolApprovalResolve: ((result: { approved: boolean; reason?: string }) => void) | undefined
	private pendingMistakeLimitResolve: ((decision: ConsecutiveMistakeLimitDecision) => void) | undefined
	private pendingToolApprovalMessage:
		| {
				toolCallId: string
				messageTs: number
				toolName: string
		  }
		| undefined

	constructor(private readonly options: SdkInteractionCoordinatorOptions) {}

	async handleConsecutiveMistakeLimitReached(
		context: ConsecutiveMistakeLimitContext,
	): Promise<ConsecutiveMistakeLimitDecision> {
		const detail = context.details?.trim()
		const latest = detail ? `${context.reason}: ${detail}` : `${context.reason} at iteration ${context.iteration}`
		const askMessage: ClineMessage = {
			ts: this.nextMessageTs(),
			type: "ask",
			ask: "mistake_limit_reached",
			text: `Cline ran into repeated tool errors (${context.consecutiveMistakes}/${context.maxConsecutiveMistakes}).\n\nLatest: ${latest}`,
			partial: false,
		}

		this.options.messages.appendAndEmit([askMessage], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		this.options.setTurnPhase?.("error", askMessage.ts)
		await this.options.postStateToWebview()

		return new Promise<ConsecutiveMistakeLimitDecision>((resolve) => {
			this.pendingMistakeLimitResolve = resolve
		})
	}

	async handleRequestToolApproval(request: ToolApprovalRequest): Promise<{ approved: boolean; reason?: string }> {
		if (request.policy.autoApprove === true || this.options.shouldAutoApproveTool?.(request) === true) {
			Logger.log(`[SdkController] Auto-approving tool execution: tool=${request.toolName}`)
			return { approved: true }
		}

		// Open the edit diff preview before the Approve/Reject buttons render. This is the only
		// pre-execution point where the adapter has the full tool input (the SDK emits the
		// tool's content events only after approval resolves).
		try {
			await this.options.onToolApprovalAsk?.(request)
		} catch (error) {
			Logger.warn(`[SdkController] onToolApprovalAsk failed; showing plain approval ask: ${error}`)
		}

		const toolAskMessage: ClineMessage = buildToolApprovalAskMessage(request.toolName, request.input, this.nextMessageTs())

		this.options.messages.appendAndEmit([toolAskMessage], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		this.options.setTurnPhase?.("awaiting_approval", toolAskMessage.ts)
		await this.options.postStateToWebview()

		return new Promise<{ approved: boolean; reason?: string }>((resolve) => {
			this.pendingToolApprovalResolve = resolve
			this.pendingToolApprovalMessage = {
				toolCallId: request.toolCallId,
				messageTs: toolAskMessage.ts,
				toolName: request.toolName,
			}
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
		this.options.setTurnPhase?.("awaiting_followup", askMessage.ts)
		await this.options.postStateToWebview()

		return new Promise<string>((resolve) => {
			this.pendingAskResolve = resolve
		})
	}

	resolvePendingToolApproval(
		prompt: string | undefined,
		responseType: ClineAskResponse | undefined,
		images?: string[],
		files?: string[],
	): boolean {
		if (!this.pendingToolApprovalResolve) {
			return false
		}

		const resolve = this.pendingToolApprovalResolve
		const pendingMessage = this.pendingToolApprovalMessage

		if (responseType === "messageResponse") {
			Logger.log("[SdkController] Leaving pending tool approval open and routing user message as queued follow-up")
			this.options.setTurnPhase?.("awaiting_approval", pendingMessage?.messageTs)
			// The approval remains pending. The chat message still needs normal follow-up routing.
			return false
		}

		this.pendingToolApprovalResolve = undefined
		this.pendingToolApprovalMessage = undefined

		const approved = responseType === "yesButtonClicked"
		Logger.log(`[SdkController] Resolving pending tool approval: approved=${approved} (responseType=${responseType})`)
		if (approved && pendingMessage) {
			this.options.recordApprovedToolMessage?.(pendingMessage.toolCallId, pendingMessage.messageTs)
		}

		// Approved or rejected by approval controls, the agent resumes its turn and returns to streaming.
		// On rejection the agent receives the denial and continues; the SDK drives the next phase.
		this.options.setTurnPhase?.("streaming")
		// The reason must state the operation did NOT happen (for edits: the file is
		// unchanged) — raw feedback alone reads like iteration on an applied change.
		const denialReason = buildToolApprovalDenialReason(pendingMessage?.toolName, prompt)
		if (!approved && (prompt?.trim() || images?.length || files?.length)) {
			const userMessage: ClineMessage = {
				ts: this.nextMessageTs(),
				type: "say",
				say: "user_feedback",
				text: prompt ?? "",
				images,
				files,
				partial: false,
			}
			this.options.messages.appendAndEmit([userMessage], {
				type: "status",
				payload: { sessionId: this.options.getSessionId(), status: "running" },
			})
		}
		if (!approved && pendingMessage) {
			this.options.recordDeniedToolApproval?.(pendingMessage.toolCallId, pendingMessage.toolName, denialReason)
		}
		resolve({
			approved,
			...(approved ? {} : { reason: denialReason }),
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

		// User answered the follow-up — the agent resumes its turn.
		this.options.setTurnPhase?.("streaming")
		resolve(responseText)
		return true
	}

	resolvePendingMistakeLimit(prompt: string | undefined, responseType: ClineAskResponse | undefined): boolean {
		if (!this.pendingMistakeLimitResolve) {
			return false
		}

		const resolve = this.pendingMistakeLimitResolve
		this.pendingMistakeLimitResolve = undefined
		this.options.setTurnPhase?.("streaming")

		if (responseType === "noButtonClicked") {
			resolve({ action: "stop", reason: "stopped after mistake_limit_reached prompt" })
			return true
		}

		const trimmedPrompt = prompt?.trim()
		if (trimmedPrompt) {
			const userMessage: ClineMessage = {
				ts: this.nextMessageTs(),
				type: "say",
				say: "user_feedback",
				text: trimmedPrompt,
				partial: false,
			}
			this.options.messages.appendAndEmit([userMessage], {
				type: "status",
				payload: { sessionId: this.options.getSessionId(), status: "running" },
			})
		}

		const guidance = trimmedPrompt
			? `mistake_limit_reached: ${trimmedPrompt}`
			: "mistake_limit_reached: retry with a different approach, validate tool parameters before calls, and avoid repeating failed steps."

		resolve({ action: "continue", guidance })
		return true
	}

	clearPending(reason: string): void {
		this.pendingAskResolve = undefined
		if (this.pendingMistakeLimitResolve) {
			this.pendingMistakeLimitResolve({ action: "stop", reason })
			this.pendingMistakeLimitResolve = undefined
		}
		const pendingMessage = this.pendingToolApprovalMessage
		this.pendingToolApprovalMessage = undefined
		if (this.pendingToolApprovalResolve) {
			// Record before resolving: the denial unblocks the core, which emits the
			// tool's lifecycle events before the caller's abort lands. Unless the
			// denial is already recorded, the translator renders those events as a
			// second tool row next to the still-visible approval ask.
			if (pendingMessage) {
				this.options.recordDeniedToolApproval?.(pendingMessage.toolCallId, pendingMessage.toolName, reason)
			}
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
