/**
 * FrameMessageBridge — ClineMessage sinks for the v2 frame stream
 * (`sdk/packages/core/docs/agent-event-stream-design.md`).
 *
 * Implements the assembler's consumer API so the frame path produces the
 * same ClineMessages as the v1 translator (`message-translator.ts`) for
 * the core agent-event surface: streaming text/reasoning rows, generic
 * tool rows, usage, iteration markers, notices, and turn terminals
 * (including the completion retag). Parity with v1 is differential-test
 * locked (frame-message-bridge.differential.test.ts): both paths mint
 * message ids at identical points, so the produced rows must be equal.
 *
 * Ordering rules are the assembler's, not this file's: sinks receive
 * updates only between their open and close, children close before the
 * turn, and a force-close (interrupted) is silent — matching v1, where a
 * dangling block simply never got its content_end (W3).
 *
 * Not yet ported (the switchover checklist in the design doc, each gated
 * by its pinned v1 translator tests): error-terminal rows
 * (reshapeErrorForWebview + api_req_failed), compaction dividers, and the
 * tool-specific renderings (completion, command, MCP, read_files /
 * apply_patch splits, ask_question suppression, spawn_agent aggregation,
 * approval-coordinator interactions). Until the switchover PR, v1 remains
 * the production ClineMessage source and this bridge runs shadow-only —
 * its output is drained and discarded by SdkFrameStream.
 */

import type { SessionConsumer, StreamDiagnostic, TurnConsumer } from "@cline/core/frames"
import type { CloseFinal, NoticeBody, Outcome, UsageBody } from "@cline/shared"
import type { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import {
	isCompletionTool,
	normalizeUsageEvent,
	parseCompactionNoticeMetadata,
	sdkToolToClineSayTool,
	toDisplaySayTool,
} from "./message-translator"

/** Retained diagnostics, newest last, bounded for a long session. */
const MAX_RETAINED_DIAGNOSTICS = 100

/**
 * Status notices that are internal diagnostics with no user-facing copy —
 * the same suppression set as the v1 translator (kept in sync with the
 * `emitStatusNotice` call sites in sdk/packages/core/src/extensions/context/compaction.ts).
 */
const INTERNAL_STATUS_NOTICES = new Set(["compaction-budget-adjusted"])

export interface FrameMessageBridgeDeps {
	/** Mint a ClineMessage ts — the same authority the v1 state uses. */
	nextTs: () => number
	/** UI mode for the completion retag's say kind; undefined means act. */
	getUiMode?: () => "plan" | "act" | "yolo" | undefined
	/** Working directory for tool-path relativization. */
	getCwd?: () => string | undefined
}

/**
 * Session-level sink: mints rows for notices/usage and delegates turn
 * bodies to per-turn consumers that hold the turn-scoped retag state.
 */
export class FrameMessageBridge implements SessionConsumer {
	private messages: ClineMessage[] = []
	diagnostics: Array<{ code: string; detail?: string; seq?: number }> = []

	/** Minting/config access shared with this file's turn consumers. */
	readonly deps: FrameMessageBridgeDeps

	constructor(deps: FrameMessageBridgeDeps) {
		this.deps = deps
	}

	/** Drain produced messages (the shadow runner discards them until switchover). */
	takeMessages(): ClineMessage[] {
		const out = this.messages
		this.messages = []
		return out
	}

	onTurn(): TurnConsumer {
		return new BridgeTurnConsumer(this)
	}

	onSessionNotice(notice: NoticeBody): void {
		// Session-scope notices render as info rows, mirroring the v1
		// translator's notice default wherever the notice fires.
		this.push({
			ts: this.deps.nextTs(),
			type: "say",
			say: "info",
			text: notice.message ?? "",
			partial: false,
		})
	}

	onIdle(): void {
		// Quiescence is a host-lifecycle signal (rebuild scheduler), not a
		// chat row; the switchover wiring subscribes to it separately.
	}

	onDiagnostic(diagnostic: StreamDiagnostic): void {
		this.diagnostics.push({
			code: diagnostic.code,
			seq: diagnostic.seq,
			detail: diagnostic.detail,
		})
		if (this.diagnostics.length > MAX_RETAINED_DIAGNOSTICS) {
			this.diagnostics.shift()
		}
		Logger.warn(
			`[FrameMessageBridge] ${diagnostic.code}${diagnostic.detail ? ` ${diagnostic.detail}` : ""} (seq ${diagnostic.seq ?? "?"})`,
		)
	}

	/** Visible to the turn consumers in this file. */
	push(message: ClineMessage): void {
		this.messages.push(message)
	}
}

/** Per-turn state: the completion-retag candidate, v1's turn-scoped rule. */
class BridgeTurnConsumer implements TurnConsumer {
	private turnFinalText: { ts: number; text: string } | undefined
	private attemptCompletionSeen = false

	constructor(private readonly bridge: FrameMessageBridge) {}

	onText(): ReturnType<TurnConsumer["onText"]> {
		const ts = this.bridge.deps.nextTs()
		const turn = this
		let accumulated = ""
		const bridge = this.bridge
		return {
			onDelta(text: string): void {
				accumulated += text
				bridge.push({ ts, type: "say", say: "text", text: accumulated, partial: true })
			},
			onAnnotation(): void {},
			onClose(outcome: Outcome, final: { text: string }): void {
				// A force-close is silent: v1 never saw a content_end for a
				// dangling text block (W3), so neither does this path.
				if (outcome.kind === "interrupted") {
					return
				}
				bridge.push({ ts, type: "say", say: "text", text: final.text, partial: false })
				if (final.text.trim()) {
					turn.recordTurnFinalText(ts, final.text)
				}
			},
		}
	}

	onReasoning(): ReturnType<TurnConsumer["onReasoning"]> {
		const ts = this.bridge.deps.nextTs()
		let accumulated = ""
		const bridge = this.bridge
		return {
			onDelta(reasoning: string): void {
				accumulated += reasoning
				bridge.push({ ts, type: "say", say: "reasoning", text: accumulated, reasoning: accumulated, partial: true })
			},
			onAnnotation(): void {},
			onClose(outcome: Outcome, final: { reasoning: string }): void {
				if (outcome.kind === "interrupted") {
					return
				}
				bridge.push({
					ts,
					type: "say",
					say: "reasoning",
					text: final.reasoning,
					reasoning: final.reasoning,
					partial: false,
				})
			},
		}
	}

	onTool(start: { toolName: string; input?: unknown }): ReturnType<TurnConsumer["onTool"]> {
		// Tool activity after a text block means that text wasn't the
		// turn-final response — drop the retag candidate (v1 rule).
		this.turnFinalText = undefined
		if (isCompletionTool(start.toolName)) {
			this.attemptCompletionSeen = true
		}
		const ts = this.bridge.deps.nextTs()
		const cwd = this.bridge.deps.getCwd?.()
		this.bridge.push({
			ts,
			type: "say",
			say: "tool",
			text: JSON.stringify(toDisplaySayTool(sdkToolToClineSayTool(start.toolName, start.input), cwd)),
			partial: true,
		})
		const bridge = this.bridge
		return {
			onProgress(): void {
				// v1 ignores content_update for generic tools; the partial
				// row from the open is the running state until close.
			},
			onAnnotation(): void {},
			onClose(outcome: Outcome, final: CloseFinal): void {
				if (outcome.kind === "interrupted") {
					// v1 W3 silence: a dangling tool never got its content_end.
					return
				}
				if (final.type !== "tool") {
					return
				}
				const input = final.input ?? start.input
				const sayTool = toDisplaySayTool(sdkToolToClineSayTool(start.toolName, input), cwd)
				bridge.push({ ts, type: "say", say: "tool", text: JSON.stringify(sayTool), partial: false })
				if (outcome.kind === "error") {
					bridge.push({
						ts: bridge.deps.nextTs(),
						type: "say",
						say: "error",
						text: outcome.error.message,
						partial: false,
					})
				}
			},
		}
	}

	onMedia(): void {
		// The v1 adapter never emits media content events.
	}

	onSubAgent(): TurnConsumer | null {
		// Main chat renders sub-agents via the spawn_agent tool rows (P5's
		// structural pruning — replaces v1's timing-based suppression).
		return null
	}

	onNotice(notice: NoticeBody): void {
		switch (notice.noticeType) {
			case "iteration_started": {
				// v1's iteration_start: an api_req_started row per API
				// request (spinner + cost display placeholder).
				this.bridge.push({
					ts: this.bridge.deps.nextTs(),
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ request: undefined } satisfies ClineApiReqInfo),
					partial: false,
				})
				return
			}
			case "iteration_finished": {
				// v1's iteration_end emits nothing.
				return
			}
			case "recovery": {
				// Recoverable errors are in-run notices, not turn outcomes;
				// any tool failure is already inline on its tool row (v1
				// parity — see the war-story comment in the v1 error case).
				Logger.warn(`[FrameMessageBridge] Recoverable agent error (run continues): ${notice.message ?? ""}`)
				return
			}
			case "status": {
				const compaction = parseCompactionNoticeMetadata(notice.metadata)
				if (compaction) {
					// Compaction dividers are not yet ported (switchover
					// checklist); log so the gap is visible in shadow runs.
					Logger.warn(`[FrameMessageBridge] Compaction notice not yet ported (phase: ${compaction.status})`)
					return
				}
				if (INTERNAL_STATUS_NOTICES.has(notice.message ?? "")) {
					return
				}
				break
			}
			default:
				break
		}
		// Non-status notices (and unrecognized status ones) are info rows —
		// a future notice surfaces as its raw slug instead of vanishing.
		this.bridge.push({
			ts: this.bridge.deps.nextTs(),
			type: "say",
			say: "info",
			text: notice.message ?? "",
			partial: false,
		})
	}

	onUsage(usage: UsageBody): void {
		const normalized = normalizeUsageEvent(usage)
		const apiReqInfo: ClineApiReqInfo = {
			tokensIn: normalized.tokensIn,
			tokensOut: normalized.tokensOut,
			cacheWrites: normalized.cacheWrites,
			cacheReads: normalized.cacheReads,
			cost: normalized.totalCost,
		}
		this.bridge.push({
			ts: this.bridge.deps.nextTs(),
			type: "say",
			say: "api_req_started",
			text: JSON.stringify(apiReqInfo),
			partial: false,
		})
	}

	onClose(outcome: Outcome): void {
		// v1 retags only on done(reason:"completed") exactly —
		// max_iterations/mistake_limit turns keep their plain text.
		const completedExactly = outcome.kind === "completed" && (outcome.finishReason ?? "completed") === "completed"
		if (completedExactly && !this.attemptCompletionSeen) {
			// Inferred completion feedback: retag the turn's final text row
			// in place (same ts) for the legacy done visual.
			const finalText = this.turnFinalText
			this.turnFinalText = undefined
			if (finalText) {
				this.bridge.push({
					ts: finalText.ts,
					type: "say",
					say: this.bridge.deps.getUiMode?.() === "plan" ? "plan_completion_result" : "completion_result",
					text: finalText.text,
					partial: false,
				})
			}
			return
		}
		if (outcome.kind === "error") {
			// Terminal error rows (api_req_failed pair) are not yet ported —
			// the switchover checklist; logged so the gap is visible.
			Logger.warn(`[FrameMessageBridge] Terminal error outcome rows not yet ported: ${outcome.error.message}`)
		}
		this.turnFinalText = undefined
	}

	private recordTurnFinalText(ts: number, text: string): void {
		this.turnFinalText = { ts, text }
	}
}
