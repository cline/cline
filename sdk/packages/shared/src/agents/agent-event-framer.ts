/**
 * AgentEvent → v2 Frame framer. Phase 1 of the agent event stream v2
 * design (`agent-event-stream-design.md`).
 *
 * The framer is the producer-side instance of the v2 tables: its state
 * is exactly the v1 tables' state (open iteration, open tools, current
 * text/reasoning), and its output is validated by `validateFrameStream`
 * derived from the v2 tables. It fixes the warts by construction:
 *
 * - W1: text/reasoning `content_start`-per-delta becomes one `open` plus
 *   `delta`s (start means start).
 * - W2: `content_end` with no prior deltas becomes open+close — never a
 *   close without an open.
 * - W3: at the turn terminal, dangling blocks are force-closed with
 *   `interrupted` before the turn close.
 * - W4/P6: the terminal has one spelling — a single turn close whose
 *   outcome says what happened; recoverable errors are notices.
 * - P3: tool close carries the input captured at open.
 *
 * Scope mapping (design: "decide at schema writing"): a v1 *run* is a
 * v2 *turn* (the unit the design's turn-end semantics describe); v1
 * *iterations* become turn-scoped notices carrying their metadata
 * (consumers used iteration boundaries as stream-reset bookkeeping,
 * which block closes make unnecessary). A session-level close frame is
 * not emitted here — it is a host-level concern wired in Phase 3.
 *
 * `seq` is monotonic for the framer's lifetime and survives turns, so
 * resume can request "everything after seq N". `epoch` changes only
 * via `bumpEpoch()` — the host's conversation fence (task switch,
 * cancel, reinit), never the run itself.
 */
import type { AgentEvent, AgentFinishReason } from "./types";
import {
	FRAME_SCHEMA_VERSION,
	type FrameBody,
	type StreamError,
	type StreamFrame,
	type Outcome,
} from "./stream-frames";

export interface AgentEventFramerOptions {
	/** Root agent first, owning agent last. Defaults to ["root"]. */
	agentPath?: string[];
	/** Starting epoch. Defaults to 0; use `bumpEpoch()` thereafter. */
	startEpoch?: number;
}

interface OpenTool {
	input: unknown;
}

export class AgentEventFramer {
	private readonly agentPath: string[];
	private epoch: number;
	private seq = 0;
	private turnCounter = 0;
	private blockCounter = 0;
	private currentTurnId: string | undefined;
	private currentTextBlock: string | undefined;
	private currentReasoningBlock: string | undefined;
	private readonly openTools = new Map<string, OpenTool>();

	constructor(options: AgentEventFramerOptions = {}) {
		this.agentPath = options.agentPath ?? ["root"];
		this.epoch = options.startEpoch ?? 0;
	}

	/** Host's conversation fence: task switch, cancel, reinit. */
	bumpEpoch(): void {
		this.epoch += 1;
	}

	/** Frames emitted so far (resumable-after-N cursor). */
	get lastSeq(): number {
		return this.seq;
	}

	/** Frame a single v1 event into zero or more v2 frames. */
	frameEvent(event: AgentEvent): StreamFrame[] {
		const out: StreamFrame[] = [];
		switch (event.type) {
			case "iteration_start": {
				const turnId = this.ensureTurn(out);
				this.emit(out, this.turnScope(turnId), {
					kind: "notice",
					noticeType: "iteration_started",
					iteration: event.iteration,
				});
				break;
			}
			case "iteration_end": {
				const turnId = this.ensureTurn(out);
				this.emit(out, this.turnScope(turnId), {
					kind: "notice",
					noticeType: "iteration_finished",
					iteration: event.iteration,
					hadToolCalls: event.hadToolCalls,
					toolCallCount: event.toolCallCount,
				});
				break;
			}
			case "content_start": {
				const turnId = this.ensureTurn(out);
				if (event.contentType === "text") {
					if (this.currentTextBlock === undefined) {
						this.currentTextBlock = this.nextBlockId();
						this.emit(
							out,
							this.blockScope(turnId, this.currentTextBlock),
							{
								kind: "open",
								openKind: "text",
								start: { blockId: this.currentTextBlock },
							},
						);
					}
					if (event.text !== undefined && event.text !== "") {
						this.emit(
							out,
							this.blockScope(turnId, this.currentTextBlock),
							{
								kind: "delta",
								payload: { type: "text", text: event.text },
							},
						);
					}
					break;
				}
				if (event.contentType === "reasoning") {
					if (this.currentReasoningBlock === undefined) {
						this.currentReasoningBlock = this.nextBlockId();
						this.emit(
							out,
							this.blockScope(turnId, this.currentReasoningBlock),
							{
								kind: "open",
								openKind: "reasoning",
								start: {
									blockId: this.currentReasoningBlock,
									redacted: event.redacted === true,
								},
							},
						);
					}
					if (event.reasoning !== undefined && event.reasoning !== "") {
						this.emit(
							out,
							this.blockScope(turnId, this.currentReasoningBlock),
							{
								kind: "delta",
								payload: {
									type: "reasoning",
									reasoning: event.reasoning,
								},
							},
						);
					}
					break;
				}
				if (event.contentType === "tool") {
					const blockId =
						event.toolCallId === undefined
							? this.nextBlockId()
							: event.toolCallId;
					// A missing toolCallId is v1-illegal (the v1 validator
					// flags it); we still frame it deterministically, and
					// the v2 tables flag the result.
					this.openTools.set(blockId, { input: event.input });
					this.emit(out, this.blockScope(turnId, blockId), {
						kind: "open",
						openKind: "tool",
						start: {
							blockId,
							toolName: event.toolName ?? "unknown",
							input: event.input,
							...(event.execution !== undefined
								? { execution: event.execution }
								: {}),
						},
					});
					break;
				}
				// media: the v1 adapter never emits a media content_start.
				break;
			}
			case "content_update": {
				const turnId = this.ensureTurn(out);
				const blockId = event.toolCallId ?? this.nextBlockId();
				this.emit(out, this.blockScope(turnId, blockId), {
					kind: "delta",
					payload: { type: "tool", update: event.update },
				});
				break;
			}
			case "content_end": {
				const turnId = this.ensureTurn(out);
				if (event.contentType === "tool") {
					const blockId =
						event.toolCallId === undefined
							? this.nextBlockId()
							: event.toolCallId;
					const tool = this.openTools.get(blockId);
					this.openTools.delete(blockId);
					this.emit(out, this.blockScope(turnId, blockId), {
						kind: "close",
						outcome: event.error
							? {
									kind: "error",
									error: {
										code: "tool_error",
										message: event.error,
									},
								}
							: { kind: "completed" },
						final: {
							type: "tool",
							input: tool?.input,
							...(event.output !== undefined
								? { output: event.output }
								: {}),
							...(event.durationMs !== undefined
								? { durationMs: event.durationMs }
								: {}),
						},
					});
					break;
				}
				if (event.contentType === "text") {
					// W2 fix: a final with no streamed deltas frames as
					// open+close, never a close without an open.
					if (this.currentTextBlock === undefined) {
						this.currentTextBlock = this.nextBlockId();
						this.emit(
							out,
							this.blockScope(turnId, this.currentTextBlock),
							{
								kind: "open",
								openKind: "text",
								start: { blockId: this.currentTextBlock },
							},
						);
					}
					this.emit(
						out,
						this.blockScope(turnId, this.currentTextBlock),
						{
							kind: "close",
							outcome: { kind: "completed" },
							final: { type: "text", text: event.text ?? "" },
						},
					);
					this.currentTextBlock = undefined;
					break;
				}
				if (event.contentType === "reasoning") {
					if (this.currentReasoningBlock === undefined) {
						this.currentReasoningBlock = this.nextBlockId();
						this.emit(
							out,
							this.blockScope(turnId, this.currentReasoningBlock),
							{
								kind: "open",
								openKind: "reasoning",
								start: {
									blockId: this.currentReasoningBlock,
									// redacted lives on the deltas, not the final;
									// a synthesized open defaults false.
									redacted: false,
								},
							},
						);
					}
					this.emit(
						out,
						this.blockScope(turnId, this.currentReasoningBlock),
						{
							kind: "close",
							outcome: { kind: "completed" },
							final: {
								type: "reasoning",
								reasoning: event.reasoning ?? "",
							},
						},
					);
					this.currentReasoningBlock = undefined;
					break;
				}
				if (event.contentType === "media") {
					// Media arrives whole: open + close, no deltas.
					const blockId = this.nextBlockId();
					this.emit(out, this.blockScope(turnId, blockId), {
						kind: "open",
						openKind: "media",
						start: { blockId },
					});
					this.emit(out, this.blockScope(turnId, blockId), {
						kind: "close",
						outcome: { kind: "completed" },
						...(event.media !== undefined
							? { final: { type: "media", media: event.media } }
							: {}),
					});
					break;
				}
				break;
			}
			case "notice": {
				const turnId = this.ensureTurn(out);
				this.emit(out, this.turnScope(turnId), {
					kind: "notice",
					noticeType: event.noticeType,
					message: event.message,
					...(event.displayRole !== undefined
						? { displayRole: event.displayRole }
						: {}),
					...(event.reason !== undefined ? { reason: event.reason } : {}),
				});
				break;
			}
			case "usage": {
				const turnId = this.ensureTurn(out);
				this.emit(out, this.turnScope(turnId), {
					kind: "usage",
					inputTokens: event.inputTokens,
					outputTokens: event.outputTokens,
					...(event.cacheReadTokens !== undefined
						? { cacheReadTokens: event.cacheReadTokens }
						: {}),
					...(event.cacheWriteTokens !== undefined
						? { cacheWriteTokens: event.cacheWriteTokens }
						: {}),
					...(event.cost !== undefined ? { cost: event.cost } : {}),
					totalInputTokens: event.totalInputTokens,
					totalOutputTokens: event.totalOutputTokens,
					...(event.totalCacheReadTokens !== undefined
						? { totalCacheReadTokens: event.totalCacheReadTokens }
						: {}),
					...(event.totalCacheWriteTokens !== undefined
						? { totalCacheWriteTokens: event.totalCacheWriteTokens }
						: {}),
					...(event.totalCost !== undefined
						? { totalCost: event.totalCost }
						: {}),
				});
				break;
			}
			case "error": {
				if (event.recoverable) {
					// W4/P6 fix: in-run errors are notices, not terminals.
					const turnId = this.ensureTurn(out);
					this.emit(out, this.turnScope(turnId), {
						kind: "notice",
						noticeType: "recovery",
						message: toStreamErrorMessage(event.error),
					});
					break;
				}
				this.closeTurn(out, {
					kind: "error",
					error: toStreamError(event.error, event.errorClass),
				});
				break;
			}
			case "done": {
				this.closeTurn(out, finishReasonToOutcome(event));
				break;
			}
			default: {
				const _exhaustive: never = event;
				void _exhaustive;
			}
		}
		return out;
	}

	/** Frame a sequence of v1 events. */
	frameAll(events: readonly AgentEvent[]): StreamFrame[] {
		const out: StreamFrame[] = [];
		for (const event of events) {
			out.push(...this.frameEvent(event));
		}
		return out;
	}

	/**
	 * Close any open scopes without a v1 terminal event — the run was
	 * fenced by the host (crash recovery, reinit), not ended by the
	 * agent. Children close with `interrupted`, the turn closes with
	 * `interrupted`. Emits nothing when the stream is already clean.
	 * Does NOT bump the epoch: that is the host's conversation-fence
	 * decision (see bumpEpoch).
	 */
	fence(): StreamFrame[] {
		const out: StreamFrame[] = [];
		if (this.currentTurnId === undefined) {
			return out;
		}
		this.closeTurn(out, { kind: "interrupted" });
		return out;
	}

	// -------------------------------------------------------------------------
	// Scope helpers
	// -------------------------------------------------------------------------

	private turnScope(turnId: string): StreamFrame["scope"] {
		return { agentPath: this.agentPath, turnId };
	}

	private blockScope(
		turnId: string,
		blockId: string,
	): StreamFrame["scope"] {
		return { agentPath: this.agentPath, turnId, blockId };
	}

	private emit(
		out: StreamFrame[],
		scope: StreamFrame["scope"],
		body: FrameBody,
	): void {
		this.seq += 1;
		const frame: StreamFrame = {
			v: FRAME_SCHEMA_VERSION,
			epoch: this.epoch,
			seq: this.seq,
			scope,
			...body,
		};
		out.push(frame);
	}

	/** Lazily open the turn at the first turn-scoped event of a run. */
	private ensureTurn(out: StreamFrame[]): string {
		if (this.currentTurnId === undefined) {
			this.turnCounter += 1;
			this.currentTurnId = `turn-${this.turnCounter}`;
			this.emit(out, this.turnScope(this.currentTurnId), {
				kind: "open",
				openKind: "turn",
				start: { turnId: this.currentTurnId },
			});
		}
		return this.currentTurnId;
	}

	private nextBlockId(): string {
		this.blockCounter += 1;
		return `blk-${this.blockCounter}`;
	}

	/** Close every open block with `interrupted` (W3: force-close). */
	private forceCloseChildren(out: StreamFrame[]): void {
		if (this.currentTurnId === undefined) {
			return;
		}
		if (this.currentTextBlock !== undefined) {
			this.emit(
				out,
				this.blockScope(this.currentTurnId, this.currentTextBlock),
				{ kind: "close", outcome: { kind: "interrupted" } },
			);
			this.currentTextBlock = undefined;
		}
		if (this.currentReasoningBlock !== undefined) {
			this.emit(
				out,
				this.blockScope(this.currentTurnId, this.currentReasoningBlock),
				{ kind: "close", outcome: { kind: "interrupted" } },
			);
			this.currentReasoningBlock = undefined;
		}
		for (const [toolCallId, tool] of this.openTools) {
			this.emit(
				out,
				this.blockScope(this.currentTurnId, toolCallId),
				{
					kind: "close",
					outcome: { kind: "interrupted" },
					final: { type: "tool", input: tool.input },
				},
			);
			this.openTools.delete(toolCallId);
		}
	}

	/** One spelling of turn end (W4/P6): children first, then the close. */
	private closeTurn(out: StreamFrame[], outcome: Outcome): void {
		const turnId = this.ensureTurn(out);
		this.forceCloseChildren(out);
		this.emit(out, this.turnScope(turnId), {
			kind: "close",
			outcome,
		});
		this.currentTurnId = undefined;
	}
}

// =============================================================================
// v1 → v2 mappers (module scope: pure, no framer state)
// =============================================================================

/**
 * P7 fix: the structured, serializable error shape. `details` would keep
 * structured provider payloads when the Error carries them (the VSCode
 * translator currently reconstructs these by string parsing).
 */
function toStreamError(
	error: unknown,
	providerErrorClass?: string,
): StreamError {
	if (error instanceof Error) {
		return {
			code: error.name || "Error",
			message: error.message,
			...(providerErrorClass !== undefined ? { providerErrorClass } : {}),
		};
	}
	return {
		code: "Error",
		message: String(error),
		...(providerErrorClass !== undefined ? { providerErrorClass } : {}),
	};
}

function toStreamErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Finish reasons map onto the one Outcome spelling (design: Frame kinds).
 * `max_iterations` and `mistake_limit` are legitimate run completions;
 * `aborted` (user cancel) is `interrupted`; `error` is the error outcome
 * (v1's done(reason:"error")-without-an-error-event case synthesizes
 * the StreamError the missing event would have carried).
 */
function finishReasonToOutcome(
	event: Extract<AgentEvent, { type: "done" }>,
): Outcome {
	const reason: AgentFinishReason = event.reason;
	switch (reason) {
		case "completed":
		case "max_iterations":
		case "mistake_limit":
			return { kind: "completed" };
		case "aborted":
			return { kind: "interrupted" };
		case "error":
			return {
				kind: "error",
				error: {
					code: "run_failed",
					message: event.text || "Run failed",
				},
			};
		default: {
			const _exhaustive: never = reason;
			void _exhaustive;
			return { kind: "completed" };
		}
	}
}

