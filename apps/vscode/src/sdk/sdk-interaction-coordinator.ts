import type { ConsecutiveMistakeLimitContext, ConsecutiveMistakeLimitDecision } from "@cline/shared"
import type { ClineAskQuestion, ClineMessage, ClineSayAutoRecovery, TurnPhase } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger"
import { MessageIdMinter } from "./message-id-minter"
import { buildToolApprovalAskMessage } from "./message-translator"
import { getFibonacciRetryDelaySeconds } from "./sdk-api-retry-coordinator"
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
	/**
	 * The task's working directory, used to relativize the absolute filesystem paths
	 * shown in tool-approval asks (display only). Optional for tests.
	 */
	getCwd?: () => string | undefined
	/**
	 * Whether the given session is still the active one. Checked after the
	 * mistake-recovery backoff sleep so a task switch or cancel during the
	 * wait stops the run instead of continuing a dead conversation. Optional
	 * for tests.
	 */
	isSessionActive?: (sessionId: string) => boolean
	/** Wait primitive for the mistake-recovery Fibonacci backoff; injectable for tests. */
	sleep?: (ms: number) => Promise<void>
	/**
	 * Read the authoritative turn phase. After the mistake-recovery backoff the
	 * coordinator only returns the UI to "streaming" when the phase is still the
	 * "retrying" one it set — if the run settled while it slept (completed,
	 * cancelled), that terminal phase must survive. Optional for tests.
	 */
	getTurnPhase?: () => TurnPhase
	/**
	 * Persist the terminal mistake-limit error row so it survives restart
	 * (task-history metadata overlay; the SDK transcript alone would drop
	 * display-only rows). Optional for tests.
	 */
	recordPersistedTaskNotice?: (sessionId: string, notice: { ts: number; text: string }) => void
}

/**
 * Automatic recovery attempts for the consecutive-mistake limit before the run
 * finally stops. Each attempt covers one full SDK mistake streak (6 consecutive
 * failures, whose counter the SDK resets on every recovery), so a run survives
 * up to 6 x 7 consecutive failures before giving up.
 */
export const MAX_MISTAKE_RECOVERY_ATTEMPTS = 6

/** Upper bound for the mistake-recovery Fibonacci backoff (3, 5, 8, 13, 21, 34, …s). */
const MAX_MISTAKE_RECOVERY_DELAY_SECONDS = 60

export class SdkInteractionCoordinator {
	private pendingAskResolve: ((answer: string) => void) | undefined
	private pendingToolApprovalResolve: ((result: { approved: boolean; reason?: string }) => void) | undefined
	private pendingToolApprovalMessage:
		| {
				toolCallId: string
				messageTs: number
				toolName: string
		  }
		| undefined

	/** Session the mistake-recovery streak belongs to; a session change resets it. */
	private mistakeRecoverySessionId = ""
	/** Recovery attempts spent on the current session's mistake streak. */
	private mistakeRecoveryCount = 0
	/** ts of the live auto-recovery countdown row; one row per streak, updated in place. */
	private autoRecoveryRowTs: number | undefined
	/** Last payload emitted on the countdown row (merge base for in-place updates). */
	private lastAutoRecoveryPayload: ClineSayAutoRecovery | undefined
	/** Session the countdown row belongs to; a session change retires it. */
	private autoRecoverySessionId = ""
	/** Recovery loop currently owning the countdown row. */
	private autoRecoveryKind: "mistake" | "api" | undefined

	constructor(private readonly options: SdkInteractionCoordinatorOptions) {}

	/**
	 * Mistake-limit recovery. The SDK already counted `maxConsecutiveMistakes`
	 * (6) consecutive failures; instead of hard-stopping the run we escalate
	 * with Fibonacci pacing: surface ONE live countdown block (say:
	 * "auto_recovery", updated in place each attempt), hold the "retrying" turn
	 * phase (stable Cancel, nothing streams below the block), wait, then
	 * continue with a consolidated error report that the SDK appends to the
	 * conversation as a user message (resetting its streak counter). After
	 * MAX_MISTAKE_RECOVERY_ATTEMPTS failed recoveries the run finally stops —
	 * but with the same resume affordance a user cancel gets (resume_task ask
	 * row + resumable phase) and a persisted error row that survives restart.
	 * No blocking ask anywhere: it would leave the agent loop running against
	 * the provider while the prompt sits unanswered.
	 */
	async handleConsecutiveMistakeLimitReached(
		context: ConsecutiveMistakeLimitContext,
	): Promise<ConsecutiveMistakeLimitDecision> {
		const sessionId = this.options.getSessionId()
		if (this.mistakeRecoverySessionId !== sessionId) {
			this.mistakeRecoverySessionId = sessionId
			this.mistakeRecoveryCount = 0
		}
		const detail = context.details?.trim()
		const latest = detail ? `${context.reason}: ${detail}` : `${context.reason} at iteration ${context.iteration}`
		// Collected before emitting this escalation's own row so the report
		// reflects the streak, not the recovery notice itself.
		const errorLog = this.options.messages.getRecentErrorTexts(8, 600, (text) => text.startsWith("Cline ran into"))

		if (this.mistakeRecoveryCount >= MAX_MISTAKE_RECOVERY_ATTEMPTS) {
			const text =
				`Cline ran into ${context.consecutiveMistakes} errors in a row and automatic recovery gave up ` +
				`after ${MAX_MISTAKE_RECOVERY_ATTEMPTS} attempts.\n\nLatest: ${latest}\n\n` +
				"The task is paused. Send a message (or press Resume) to give Cline guidance and continue."
			// The countdown marker settles — the decorated error block reverts
			// to its plain exclamation glyph (no text ever changes) and the
			// footer's phase change surfaces the recovery affordances.
			this.settleAutoRecovery()
			// Persist the terminal error row: the transcript only carries
			// conversation messages, so without this the row vanishes on restart.
			this.options.recordPersistedTaskNotice?.(sessionId, { ts: Date.now(), text })
			// Resume affordance, mirroring what cancelTask emits: the ask row
			// anchors the webview's Resume Task button.
			const askMessage: ClineMessage = {
				ts: this.nextMessageTs(),
				type: "ask",
				ask: "resume_task",
				text: "",
				partial: false,
			}
			this.options.messages.appendAndEmit([askMessage], {
				type: "status",
				payload: { sessionId, status: "cancelled" },
			})
			this.options.setTurnPhase?.("resumable", askMessage.ts)
			await this.options.postStateToWebview()
			return { action: "stop", reason: `mistake_limit_reached: ${latest}` }
		}

		this.mistakeRecoveryCount += 1
		const attempt = this.mistakeRecoveryCount
		const delaySeconds = getFibonacciRetryDelaySeconds(attempt, MAX_MISTAKE_RECOVERY_DELAY_SECONDS)
		// One updatable marker per streak: each attempt re-emits the SAME message
		// (same ts) so the single error block's glyph counts down to the next
		// retry while its text stays frozen, and the footer holds a stable Cancel
		// ("retrying" phase).
		this.beginAutoRecoveryCountdown({ kind: "mistake", delaySeconds })
		await this.options.postStateToWebview()

		const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
		await sleep(delaySeconds * 1000)

		// The wait raced a task switch, cancel, or brand-new session: continuing
		// would append guidance to a conversation nobody is driving.
		const sessionEnded =
			sessionId !== this.options.getSessionId() ||
			(this.options.isSessionActive ? !this.options.isSessionActive(sessionId) : false)
		if (sessionEnded) {
			this.settleAutoRecovery()
			return {
				action: "stop",
				reason: `mistake_limit_reached: session ended during recovery backoff (${latest})`,
			}
		}

		// Countdown over: hand the UI back to streaming so the retried operation's
		// output reappears (rows below the decorated error block are hidden only
		// while the phase is "retrying"). Guarded — if the run settled while we
		// slept, that terminal phase wins. Post immediately so the held rows
		// release now, not whenever the in-flight iteration's next event lands.
		if (this.options.getTurnPhase?.() === "retrying") {
			this.options.setTurnPhase?.("streaming")
			await this.options.postStateToWebview()
		}
		this.markAutoRecoveryRetrying()
		return { action: "continue", guidance: this.buildMistakeRecoveryGuidance(context, latest, errorLog) }
	}

	/** Clears the recovery streak (a turn completed, or the user re-drove the task). */
	resetMistakeEscalation(): void {
		this.mistakeRecoveryCount = 0
		// A productive turn landed while a countdown marker was live: the
		// recovery worked — settle it instead of leaving a stale ring.
		if (this.isAutoRecoveryActive("mistake")) {
			this.settleAutoRecovery()
		}
	}

	// =============================================================================
	// Shared auto-recovery countdown marker
	//
	// One say:"auto_recovery" marker per recovery streak, updated in place (same
	// ts) via the message-state merge. It never renders as its own row: the
	// webview attaches it to the streak's first error block and swaps that
	// block's exclamation glyph for a live countdown ring (then a spinner while
	// the retry streams), so the error text stays frozen instead of flooding the
	// chat with per-attempt rows. Owned by the mistake loop here and by the API
	// auto-retry coordinator through the public methods below.
	// =============================================================================

	/**
	 * Begin (or continue) the countdown marker for a recovery streak and hold
	 * the "retrying" turn phase — the footer stays a stable Cancel and the
	 * webview hides rows below the decorated error block until the retried
	 * operation actually streams.
	 */
	beginAutoRecoveryCountdown(input: { kind: "mistake" | "api"; delaySeconds: number }): void {
		const sessionId = this.options.getSessionId()
		if (this.autoRecoverySessionId !== sessionId) {
			// A previous session's marker is dead state; never emit into the new task.
			this.clearAutoRecoveryRow()
			this.autoRecoverySessionId = sessionId
		}
		const payload: ClineSayAutoRecovery = {
			kind: input.kind,
			status: "countdown",
			delaySeconds: input.delaySeconds,
			retryAt: Date.now() + input.delaySeconds * 1000,
		}
		this.autoRecoveryKind = input.kind
		this.autoRecoveryRowTs = this.emitAutoRecoveryRow(sessionId, payload, this.autoRecoveryRowTs)
		this.options.setTurnPhase?.("retrying", this.autoRecoveryRowTs)
	}

	/** The countdown ended and the retry is going out — swap the ring for a spinner. */
	markAutoRecoveryRetrying(): void {
		this.updateAutoRecoveryRow({ status: "retrying", retryAt: undefined })
	}

	/**
	 * Settle the countdown marker: the recovery is over (turn completed, mistake
	 * recovery exhausted, or streak abandoned — settings flipped, task
	 * cancelled/switched). The decorated error block reverts to its plain
	 * exclamation glyph; no text ever changes.
	 */
	settleAutoRecovery(): void {
		this.updateAutoRecoveryRow({ status: "settled", retryAt: undefined })
	}

	/** Whether the given recovery loop owns an unfinished countdown row on the active session. */
	isAutoRecoveryActive(kind: "mistake" | "api"): boolean {
		return (
			this.autoRecoveryKind === kind &&
			this.autoRecoveryRowTs !== undefined &&
			this.autoRecoverySessionId === this.options.getSessionId() &&
			this.lastAutoRecoveryPayload !== undefined &&
			(this.lastAutoRecoveryPayload.status === "countdown" || this.lastAutoRecoveryPayload.status === "retrying")
		)
	}

	/** Merge a partial payload update onto the countdown row and re-emit it (same ts). */
	private updateAutoRecoveryRow(changes: Partial<ClineSayAutoRecovery>): void {
		if (this.autoRecoveryRowTs === undefined || this.lastAutoRecoveryPayload === undefined) {
			return
		}
		if (this.autoRecoverySessionId !== this.options.getSessionId()) {
			// The row belongs to a previous task; never emit into the active one.
			this.clearAutoRecoveryRow()
			return
		}
		this.emitAutoRecoveryRow(
			this.autoRecoverySessionId,
			{ ...this.lastAutoRecoveryPayload, ...changes },
			this.autoRecoveryRowTs,
		)
		const settled = this.lastAutoRecoveryPayload.status !== "countdown" && this.lastAutoRecoveryPayload.status !== "retrying"
		if (settled) {
			this.clearAutoRecoveryRow()
		}
	}

	/** Append (or update, same ts) the countdown row; identical ts means in-place update. */
	private emitAutoRecoveryRow(sessionId: string, payload: ClineSayAutoRecovery, ts?: number): number {
		const row: ClineMessage = {
			ts: ts ?? this.nextMessageTs(),
			type: "say",
			say: "auto_recovery",
			text: JSON.stringify(payload),
			partial: false,
		}
		this.options.messages.appendAndEmit([row], {
			type: "status",
			payload: { sessionId, status: "running" },
		})
		this.lastAutoRecoveryPayload = payload
		return row.ts
	}

	private clearAutoRecoveryRow(): void {
		this.autoRecoveryRowTs = undefined
		this.lastAutoRecoveryPayload = undefined
		this.autoRecoveryKind = undefined
	}

	private buildMistakeRecoveryGuidance(context: ConsecutiveMistakeLimitContext, latest: string, errorLog: string[]): string {
		const lines = [
			`[mistake_limit_reached] The last ${context.consecutiveMistakes} consecutive attempts failed (${latest}).`,
			"",
			"Full error log, most recent last:",
		]
		if (errorLog.length > 0) {
			errorLog.forEach((text, index) => {
				lines.push(`${index + 1}. ${text}`)
			})
		} else {
			lines.push(`1. ${latest}`)
		}
		lines.push(
			"",
			"Before responding, reconsider the approach. Do NOT repeat the same tool call unchanged: change the tool, the arguments, or the target path. If the environment itself is broken, report the problem and ask the user instead of retrying.",
		)
		return lines.join("\n")
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

		const toolAskMessage: ClineMessage = buildToolApprovalAskMessage(
			request.toolName,
			request.input,
			this.nextMessageTs(),
			this.options.getCwd?.(),
		)

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

	clearPending(reason: string): void {
		const resolveAsk = this.pendingAskResolve
		this.pendingAskResolve = undefined
		// ask_question is awaiting this promise inside the outgoing agent run. Settle it
		// before session teardown so the run can unwind instead of remaining suspended;
		// use an empty answer so the lifecycle reason is not presented as user input.
		resolveAsk?.("")

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
