/**
 * Stream assembler — Phase 2 of the agent event stream v2 design
 * (`docs/agent-event-stream-design.md`). The consumer-side instance of
 * the v2 tables: parses `StreamFrame`s into the push-based consumer
 * API, so a consumer implements rendering only and ordering rules are
 * unrepresentable in its code (you cannot handle an update for a block
 * you were never handed).
 *
 * Delivery contract (test-locked):
 * 1. Callbacks fire in frame order.
 * 2. `onClose` is the last non-annotation call on a sink; annotations
 *    may arrive later (post-close annotations target real scopes).
 * 3. Every child sink's `onClose` fires before its turn's `onClose`.
 * 4. On a violating frame the assembler repairs to the nearest legal
 *    state (drops stale-epoch frames, drops orphan block frames,
 *    force-closes open children before a turn close) and reports via
 *    `onDiagnostic`; legal streams produce zero diagnostics.
 * 5. `onIdle` fires exactly once per transition to quiescence (no open
 *    turn and no open run scopes).
 *
 * Scope mapping follows the Phase 1 decisions: a v1 run is a v2 turn;
 * iterations are turn-scoped notices; media arrives whole (open then
 * close, delivered as `onMedia`). The assembler is per-agent-stream —
 * one instance per consumer per `agentPath`.
 */
import type {
	CloseFinal,
	NoticeBody,
	Outcome,
	ReasoningStart,
	StreamFrame,
	TextStart,
	ToolStart,
	UsageBody,
} from "@cline/shared";

// =============================================================================
// Consumer API
// =============================================================================

/** Diagnostics: repairs and unsupported routes. Not violations — the
 * stream was made legal; the consumer is told what happened. */
export interface StreamDiagnostic {
	code: string;
	seq?: number;
	detail?: string;
}

export interface TextSink {
	onDelta(text: string): void;
	onAnnotation(annotation: unknown): void;
	onClose(outcome: Outcome): void;
}

export interface ReasoningSink {
	onDelta(reasoning: string): void;
	onAnnotation(annotation: unknown): void;
	onClose(outcome: Outcome): void;
}

export interface ToolSink {
	onProgress(update: unknown): void;
	onAnnotation(annotation: unknown): void;
	onClose(outcome: Outcome, final: CloseFinal): void;
}

/** Media arrives whole; the assembler delivers the close's final. */
export interface MediaFinal {
	media: unknown;
}

/** Observer for sub-agent streams; null from `onSubAgent` prunes the
 * subtree (Phase 3 wires real sub-agent frames; the hook exists now so
 * the consumer API is total). */
export interface TurnObserver {
	onNotice(notice: NoticeBody): void;
	onUsage(usage: UsageBody): void;
	onClose(outcome: Outcome): void;
}

export interface TurnConsumer {
	onText(start: TextStart): TextSink;
	onReasoning(start: ReasoningStart): ReasoningSink;
	onTool(start: ToolStart): ToolSink;
	onMedia(media: MediaFinal): void;
	onSubAgent(start: { agentId: string }): TurnObserver | null;
	onNotice(notice: NoticeBody): void;
	onUsage(usage: UsageBody): void;
	onClose(outcome: Outcome, iterations?: number): void;
}

export interface SessionConsumer {
	onTurn(start: { turnId: string }): TurnConsumer;
	onSessionNotice(notice: NoticeBody): void;
	/** Edge-triggered: no open turn and no open run scopes. */
	onIdle(): void;
	onDiagnostic(diagnostic: StreamDiagnostic): void;
}

// =============================================================================
// Assembler
// =============================================================================

interface OpenBlock {
	kind: "text" | "reasoning" | "tool" | "media";
	turnId: string;
	sink: TextSink | ReasoningSink | ToolSink | undefined;
	/** Tool opens carry the input the force-close final needs. */
	start?: ToolStart;
}

export const DIAG_STALE_EPOCH = "stale-epoch";
export const DIAG_ORPHAN_BLOCK_FRAME = "orphan-block-frame";
export const DIAG_TURN_CLOSE_WITHOUT_OPEN = "turn-close-without-open";
export const DIAG_TURN_OPEN_WHILE_OPEN = "turn-open-while-open";
export const DIAG_ANNOTATION_UNROUTED = "annotation-unrouted";
export const DIAG_SNAPSHOT_UNROUTED = "snapshot-unrouted";
export const DIAG_AFTER_SESSION_END = "after-session-end";
export const DIAG_BLOCK_OPEN_WHILE_OPEN = "block-open-while-open";

export class StreamAssembler {
	private readonly consumer: SessionConsumer;
	private epoch: number | undefined;
	private ended = false;
	private idleNotified = false;
	private openTurn: { turnId: string; consumer: TurnConsumer } | undefined;
	private readonly openBlocks = new Map<string, OpenBlock>();
	private openRunCount = 0;

	constructor(consumer: SessionConsumer) {
		this.consumer = consumer;
	}

	/** Frames still open — the live set, derived from the routing table. */
	openScopes(): { turnId?: string; blocks: string[] } {
		return {
			turnId: this.openTurn?.turnId,
			blocks: [...this.openBlocks.keys()],
		};
	}

	push(frame: StreamFrame): void {
		if (this.ended) {
			this.diagnose(DIAG_AFTER_SESSION_END, frame);
			return;
		}
		if (this.epoch === undefined) {
			this.epoch = frame.epoch;
		} else if (frame.epoch < this.epoch) {
			// Stale frame from a fenced conversation: dropped, not merged.
			this.diagnose(DIAG_STALE_EPOCH, frame);
			return;
		}
		this.epoch = frame.epoch;

		const turnId = frame.scope.turnId;
		const blockId = frame.scope.blockId;

		switch (frame.kind) {
			case "open": {
				if (frame.openKind === "turn") {
					this.openTurnFrame(frame, turnId);
				} else {
					this.openBlockFrame(frame, turnId, blockId);
				}
				break;
			}
			case "delta": {
				const block =
					blockId !== undefined ? this.openBlocks.get(blockId) : undefined;
				if (block === undefined || block.turnId !== turnId) {
					this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, blockId);
					break;
				}
				if (block.sink === undefined) {
					break;
				}
				if (block.kind === "text") {
					(block.sink as TextSink).onDelta(
						frame.payload.type === "text" ? frame.payload.text : "",
					);
				} else if (block.kind === "reasoning") {
					(block.sink as ReasoningSink).onDelta(
						frame.payload.type === "reasoning" ? frame.payload.reasoning : "",
					);
				} else if (block.kind === "tool") {
					(block.sink as ToolSink).onProgress(
						frame.payload.type === "tool" ? frame.payload.update : undefined,
					);
				}
				break;
			}
			case "close": {
				if (blockId !== undefined) {
					this.closeBlockFrame(frame, turnId, blockId);
				} else {
					this.closeTurnFrame(frame, turnId);
				}
				break;
			}
			case "notice": {
				if (turnId === undefined) {
					this.consumer.onSessionNotice(frame);
					break;
				}
				const noticeTurn = this.openTurn;
				if (noticeTurn !== undefined && noticeTurn.turnId === turnId) {
					noticeTurn.consumer.onNotice(frame);
				} else {
					this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, turnId);
				}
				break;
			}
			case "usage": {
				const usageTurn = this.openTurn;
				if (usageTurn !== undefined && usageTurn.turnId === turnId) {
					usageTurn.consumer.onUsage(frame);
				} else {
					this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, turnId);
				}
				break;
			}
			case "annotation": {
				const block =
					blockId !== undefined ? this.openBlocks.get(blockId) : undefined;
				if (block?.sink !== undefined) {
					(block.sink as ToolSink).onAnnotation(frame);
				} else {
					this.diagnose(DIAG_ANNOTATION_UNROUTED, frame);
				}
				break;
			}
			case "snapshot": {
				// Reconnect reconciliation is Phase 3; until then snapshots
				// are reported, not applied.
				this.diagnose(DIAG_SNAPSHOT_UNROUTED, frame);
				break;
			}
			default: {
				const _exhaustive: never = frame;
				void _exhaustive;
			}
		}
	}

	pushAll(frames: readonly StreamFrame[]): void {
		for (const frame of frames) {
			this.push(frame);
		}
	}

	// -------------------------------------------------------------------------

	private diagnose(code: string, frame: StreamFrame, detail?: string): void {
		this.consumer.onDiagnostic({ code, seq: frame.seq, detail });
	}

	private openTurnFrame(frame: StreamFrame, turnId: string | undefined): void {
		if (this.openTurn !== undefined) {
			// Repair: close the abandoned turn as interrupted, then open
			// the new one.
			this.closeChildren(this.openTurn.turnId);
			this.openTurn.consumer.onClose({ kind: "interrupted" });
			this.diagnose(DIAG_TURN_OPEN_WHILE_OPEN, frame, this.openTurn.turnId);
			this.openTurn = undefined;
		}
		if (turnId === undefined) {
			this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, "(missing turnId)");
			return;
		}
		this.openTurn = { turnId, consumer: this.consumer.onTurn({ turnId }) };
		this.idleNotified = false;
	}

	private openBlockFrame(
		frame: StreamFrame & { kind: "open" },
		turnId: string | undefined,
		blockId: string | undefined,
	): void {
		if (
			this.openTurn === undefined ||
			this.openTurn.turnId !== turnId ||
			blockId === undefined
		) {
			this.diagnose(
				DIAG_ORPHAN_BLOCK_FRAME,
				frame,
				blockId ?? turnId ?? "(unaddressed)",
			);
			return;
		}
		if (this.openBlocks.has(blockId)) {
			this.diagnose(DIAG_BLOCK_OPEN_WHILE_OPEN, frame, blockId);
			return;
		}
		const consumer = this.openTurn.consumer;
		if (frame.openKind === "text") {
			this.openBlocks.set(blockId, {
				kind: "text",
				turnId,
				sink: consumer.onText(frame.start),
			});
		} else if (frame.openKind === "reasoning") {
			this.openBlocks.set(blockId, {
				kind: "reasoning",
				turnId,
				sink: consumer.onReasoning(frame.start),
			});
		} else if (frame.openKind === "tool") {
			this.openBlocks.set(blockId, {
				kind: "tool",
				turnId,
				sink: consumer.onTool(frame.start),
				start: frame.start,
			});
		} else {
			// Media arrives whole: the open is bookkeeping so the close
			// matches; no sink is created.
			this.openBlocks.set(blockId, { kind: "media", turnId, sink: undefined });
		}
	}

	private closeBlockFrame(
		frame: StreamFrame & { kind: "close" },
		turnId: string | undefined,
		blockId: string,
	): void {
		const block = this.openBlocks.get(blockId);
		if (block === undefined || block.turnId !== turnId) {
			this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, blockId);
			return;
		}
		this.openBlocks.delete(blockId);
		if (block.kind === "media") {
			if (frame.final !== undefined && this.openTurn?.turnId === turnId) {
				this.openTurn.consumer.onMedia({
					media: (frame.final as { media: unknown }).media,
				});
			}
			return;
		}
		if (block.sink === undefined) {
			return;
		}
		if (block.kind === "tool") {
			(block.sink as ToolSink).onClose(
				frame.outcome,
				frame.final ?? { type: "tool", input: block.start?.input },
			);
		} else {
			(block.sink as TextSink).onClose(frame.outcome);
		}
	}

	private closeTurnFrame(
		frame: StreamFrame & { kind: "close" },
		turnId: string | undefined,
	): void {
		if (turnId === undefined) {
			// Session-scoped close: repair everything, then end.
			this.ended = true;
			if (this.openTurn !== undefined) {
				this.closeChildren(this.openTurn.turnId);
				this.openTurn.consumer.onClose({ kind: "interrupted" });
				this.openTurn = undefined;
			}
			this.notifyIdle();
			return;
		}
		if (this.openTurn === undefined || this.openTurn.turnId !== turnId) {
			this.diagnose(DIAG_TURN_CLOSE_WITHOUT_OPEN, frame, turnId);
			return;
		}
		this.closeChildren(turnId);
		this.openTurn.consumer.onClose(frame.outcome, frame.iterations);
		this.openTurn = undefined;
		this.notifyIdle();
	}

	/** Force-close children of the turn (delivery contract rule 3). */
	private closeChildren(turnId: string): void {
		for (const [blockId, block] of [...this.openBlocks.entries()]) {
			if (block.turnId !== turnId) {
				continue;
			}
			this.openBlocks.delete(blockId);
			if (block.sink === undefined) {
				continue;
			}
			if (block.kind === "tool") {
				(block.sink as ToolSink).onClose(
					{ kind: "interrupted" },
					{ type: "tool", input: block.start?.input },
				);
			} else {
				(block.sink as TextSink).onClose({ kind: "interrupted" });
			}
		}
	}

	private notifyIdle(): void {
		if (
			!this.idleNotified &&
			this.openTurn === undefined &&
			this.openRunCount === 0
		) {
			this.idleNotified = true;
			this.consumer.onIdle();
		}
	}
}

