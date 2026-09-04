/**
 * Stream assembler — Phase 2/3a of the agent event stream v2 design
 * (`docs/agent-event-stream-design.md`). The consumer-side instance of
 * the v2 tables: parses `StreamFrame`s into the push-based consumer
 * API, so a consumer implements rendering only and ordering rules are
 * unrepresentable in its code.
 *
 * Delivery contract (test-locked):
 * 1. Callbacks fire in frame order.
 * 2. `onClose` is the last non-annotation call on a sink.
 * 3. Every child sink's `onClose` fires before its turn's `onClose`,
 *    and every sub-agent stream closes before the spawning turn's
 *    `onClose` (scope tree rule 3).
 * 4. On a violating frame the assembler repairs to the nearest legal
 *    state and reports via `onDiagnostic`. Pruning is NOT a violation:
 *    `onSubAgent` returning null drops that subtree's frames silently
 *    (design P5 — structural pruning replaces the v1 timing heuristic).
 * 5. `onIdle` fires exactly once per transition to quiescence.
 *
 * Address-keyed (Phase 3a): turns and blocks are keyed by full scope
 * address, so multiplexed agent streams — each minting their own
 * `turn-1` — route independently. Sub-agent streams get their consumer
 * from the spawning turn's `onSubAgent`; their turn opens are scope
 * bookkeeping (no callback — `onSubAgent` was the callback), and their
 * blocks/notices flow to that consumer.
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
	/** `final` is the close frame's authoritative text — it can differ
	 * from the concatenated deltas (the v1 final is producer-truth). */
	onClose(outcome: Outcome, final: { text: string }): void;
}

export interface ReasoningSink {
	onDelta(reasoning: string): void;
	onAnnotation(annotation: unknown): void;
	onClose(outcome: Outcome, final: { reasoning: string }): void;
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

/**
 * Consumer for one agent stream. Sub-agents return one from
 * `TurnConsumer.onSubAgent` (a full TurnConsumer, not the design doc's
 * minimal TurnObserver: sub-agent streams carry their own text and
 * tool blocks); the root stream's consumer comes from
 * `SessionConsumer.onTurn` per turn.
 */
export interface TurnConsumer {
	onText(start: TextStart): TextSink;
	onReasoning(start: ReasoningStart): ReasoningSink;
	onTool(start: ToolStart): ToolSink;
	onMedia(media: MediaFinal): void;
	/** Null prunes the subtree — its frames are dropped, silently and
	 * deliberately (design P5). */
	onSubAgent(start: { agentId: string }): TurnConsumer | null;
	onNotice(notice: NoticeBody): void;
	onUsage(usage: UsageBody): void;
	onClose(outcome: Outcome, iterations?: number): void;
}

export interface SessionConsumer {
	onTurn(start: { turnId: string }): TurnConsumer;
	onSessionNotice(notice: NoticeBody): void;
	/** Edge-triggered: no open turn (any path) and no open run scopes. */
	onIdle(): void;
	onDiagnostic(diagnostic: StreamDiagnostic): void;
}

// =============================================================================
// Assembler
// =============================================================================

interface OpenBlock {
	kind: "text" | "reasoning" | "tool" | "media";
	blockKey: string;
	sink: TextSink | ReasoningSink | ToolSink | undefined;
	/** Tool opens carry the input the force-close final needs. */
	start?: ToolStart;
}

interface OpenTurn {
	turnId: string;
	consumer: TurnConsumer;
}

export const DIAG_STALE_EPOCH = "stale-epoch";
export const DIAG_ORPHAN_BLOCK_FRAME = "orphan-block-frame";
export const DIAG_TURN_CLOSE_WITHOUT_OPEN = "turn-close-without-open";
export const DIAG_TURN_OPEN_WHILE_OPEN = "turn-open-while-open";
export const DIAG_SUBAGENT_WITHOUT_TURN = "subagent-without-turn";
export const DIAG_ANNOTATION_UNROUTED = "annotation-unrouted";
export const DIAG_SNAPSHOT_UNROUTED = "snapshot-unrouted";
export const DIAG_AFTER_SESSION_END = "after-session-end";
export const DIAG_BLOCK_OPEN_WHILE_OPEN = "block-open-while-open";

const ROOT = "root";

export class StreamAssembler {
	private readonly consumer: SessionConsumer;
	private epoch: number | undefined;
	private ended = false;
	private idleNotified = false;
	/** pathKey -> open turn (one per agent path). */
	private readonly openTurns = new Map<string, OpenTurn>();
	/** blockKey (path/turn/block) -> open block. */
	private readonly openBlocks = new Map<string, OpenBlock>();
	/** pathKey -> sub-agent consumer; null = pruned subtree. */
	private readonly subAgents = new Map<string, TurnConsumer | null>();

	constructor(consumer: SessionConsumer) {
		this.consumer = consumer;
	}

	/** Scopes still open — the live set, derived from the routing tables. */
	openScopes(): { turnPaths: string[]; blocks: string[] } {
		return {
			turnPaths: [...this.openTurns.keys()],
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
			this.diagnose(DIAG_STALE_EPOCH, frame);
			return;
		}
		this.epoch = frame.epoch;

		const pathKey = frame.scope.agentPath.join("/");
		if (pathKey !== ROOT && !this.routeSubAgent(pathKey, frame)) {
			// Unroutable (diagnostic already emitted) or pruned (silent).
			return;
		}

		const turnId = frame.scope.turnId;
		const blockId = frame.scope.blockId;
		const turnKey = turnId !== undefined ? `${pathKey}/${turnId}` : undefined;
		const blockKey =
			turnKey !== undefined && blockId !== undefined
				? `${turnKey}/${blockId}`
				: undefined;

		switch (frame.kind) {
			case "open": {
				if (frame.openKind === "turn") {
					this.openTurnFrame(pathKey, turnId, frame);
				} else {
					this.openBlockFrame(frame, pathKey, turnKey, blockKey);
				}
				break;
			}
			case "delta": {
				const block =
					blockKey !== undefined ? this.openBlocks.get(blockKey) : undefined;
				if (block === undefined) {
					this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, blockKey);
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
				if (blockKey !== undefined) {
					this.closeBlockFrame(frame, blockKey);
				} else {
					this.closeTurnFrame(frame, pathKey, turnId);
				}
				break;
			}
			case "notice": {
				if (turnKey === undefined) {
					this.consumer.onSessionNotice(frame);
					break;
				}
				const noticeTurn = this.openTurns.get(pathKey);
				if (noticeTurn !== undefined && noticeTurn.turnId === turnId) {
					noticeTurn.consumer.onNotice(frame);
				} else {
					this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, turnKey);
				}
				break;
			}
			case "usage": {
				const usageTurn = this.openTurns.get(pathKey);
				if (usageTurn !== undefined && usageTurn.turnId === turnId) {
					usageTurn.consumer.onUsage(frame);
				} else {
					this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, turnKey);
				}
				break;
			}
			case "annotation": {
				const block =
					blockKey !== undefined ? this.openBlocks.get(blockKey) : undefined;
				if (block?.sink !== undefined) {
					(block.sink as ToolSink).onAnnotation(frame);
				} else {
					this.diagnose(DIAG_ANNOTATION_UNROUTED, frame);
				}
				break;
			}
			case "snapshot": {
				// Reconnect reconciliation is Phase 3b; until then snapshots
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

	/** Resolve (or prune) the consumer for a non-root agent path. Returns
	 * true when frames for the path may be processed. */
	private routeSubAgent(pathKey: string, frame: StreamFrame): boolean {
		if (this.subAgents.has(pathKey)) {
			return this.subAgents.get(pathKey) !== null;
		}
		const segments = pathKey.split("/");
		const agentId = segments[segments.length - 1];
		const parentKey = segments.slice(0, -1).join("/");
		const parent = this.openTurns.get(parentKey);
		if (parent === undefined) {
			this.diagnose(DIAG_SUBAGENT_WITHOUT_TURN, frame, pathKey);
			return false;
		}
		const child = parent.consumer.onSubAgent({ agentId });
		this.subAgents.set(pathKey, child);
		return child !== null;
	}

	private openTurnFrame(
		pathKey: string,
		turnId: string | undefined,
		frame: StreamFrame,
	): void {
		if (this.openTurns.has(pathKey)) {
			// Repair: close the abandoned turn as interrupted, then open
			// the new one on this path.
			this.closePathTurn(pathKey, { kind: "interrupted" });
			this.diagnose(DIAG_TURN_OPEN_WHILE_OPEN, frame, pathKey);
		}
		if (turnId === undefined) {
			this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, "(missing turnId)");
			return;
		}
		const consumer =
			pathKey === ROOT
				? this.consumer.onTurn({ turnId })
				: this.subAgents.get(pathKey);
		if (consumer === undefined || consumer === null) {
			this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, pathKey);
			return;
		}
		this.openTurns.set(pathKey, { turnId, consumer });
		this.idleNotified = false;
	}

	private openBlockFrame(
		frame: StreamFrame & { kind: "open" },
		pathKey: string,
		turnKey: string | undefined,
		blockKey: string | undefined,
	): void {
		const turn = this.openTurns.get(pathKey);
		if (
			turn === undefined ||
			turnKey === undefined ||
			blockKey === undefined ||
			turn.turnId !== frame.scope.turnId
		) {
			this.diagnose(
				DIAG_ORPHAN_BLOCK_FRAME,
				frame,
				blockKey ?? turnKey ?? "(unaddressed)",
			);
			return;
		}
		if (this.openBlocks.has(blockKey)) {
			this.diagnose(DIAG_BLOCK_OPEN_WHILE_OPEN, frame, blockKey);
			return;
		}
		const consumer = turn.consumer;
		if (frame.openKind === "text") {
			this.openBlocks.set(blockKey, {
				kind: "text",
				blockKey,
				sink: consumer.onText(frame.start),
			});
		} else if (frame.openKind === "reasoning") {
			this.openBlocks.set(blockKey, {
				kind: "reasoning",
				blockKey,
				sink: consumer.onReasoning(frame.start),
			});
		} else if (frame.openKind === "tool") {
			this.openBlocks.set(blockKey, {
				kind: "tool",
				blockKey,
				sink: consumer.onTool(frame.start),
				start: frame.start,
			});
		} else {
			// Media arrives whole: the open is bookkeeping so the close
			// matches; no sink is created.
			this.openBlocks.set(blockKey, {
				kind: "media",
				blockKey,
				sink: undefined,
			});
		}
	}

	private closeBlockFrame(
		frame: StreamFrame & { kind: "close" },
		blockKey: string,
	): void {
		const block = this.openBlocks.get(blockKey);
		if (block === undefined) {
			this.diagnose(DIAG_ORPHAN_BLOCK_FRAME, frame, blockKey);
			return;
		}
		this.openBlocks.delete(blockKey);
		if (block.kind === "media") {
			if (frame.final !== undefined) {
				const pathSegments = blockKey.split("/");
				const turn = this.openTurns.get(
					pathSegments.slice(0, -2).join("/"),
				);
				turn?.consumer.onMedia({
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
		} else if (block.kind === "text") {
			const final =
				frame.final !== undefined && frame.final.type === "text"
					? frame.final
					: { type: "text" as const, text: "" };
			(block.sink as TextSink).onClose(frame.outcome, final);
		} else {
			const final =
				frame.final !== undefined && frame.final.type === "reasoning"
					? frame.final
					: { type: "reasoning" as const, reasoning: "" };
			(block.sink as ReasoningSink).onClose(frame.outcome, final);
		}
	}

	private closeTurnFrame(
		frame: StreamFrame & { kind: "close" },
		pathKey: string,
		turnId: string | undefined,
	): void {
		if (turnId === undefined) {
			// Session-scoped close: repair everything, then end.
			this.ended = true;
			for (const openPath of [...this.openTurns.keys()].sort(
				(a, b) => b.length - a.length,
			)) {
				this.closePathTurn(openPath, { kind: "interrupted" });
			}
			this.notifyIdle();
			return;
		}
		const turn = this.openTurns.get(pathKey);
		if (turn === undefined || turn.turnId !== turnId) {
			this.diagnose(DIAG_TURN_CLOSE_WITHOUT_OPEN, frame, pathKey);
			return;
		}
		this.closePathTurn(pathKey, frame.outcome, frame.iterations);
		this.notifyIdle();
	}

	/** Close the path's open turn: its blocks, its sub-agents (deep
	 * first), then the turn's own onClose (delivery rule 3). */
	private closePathTurn(
		pathKey: string,
		outcome: Outcome,
		iterations?: number,
	): void {
		const turn = this.openTurns.get(pathKey);
		if (turn === undefined) {
			return;
		}
		this.closeBlocksOfTurn(pathKey, turn.turnId);
		// Sub-agent streams spawned under this turn close first, deepest
		// paths first so nested spawns unwind inside-out.
		for (const childPath of [...this.openTurns.keys()]
			.filter((key) => key.startsWith(`${pathKey}/`))
			.sort((a, b) => b.length - a.length)) {
			this.closePathTurn(childPath, { kind: "interrupted" });
		}
		// Registrations are per-spawn: a later spawn re-asks onSubAgent.
		for (const key of [...this.subAgents.keys()]) {
			if (key === pathKey || key.startsWith(`${pathKey}/`)) {
				this.subAgents.delete(key);
			}
		}
		turn.consumer.onClose(outcome, iterations);
		this.openTurns.delete(pathKey);
	}

	private closeBlocksOfTurn(pathKey: string, turnId: string): void {
		const prefix = `${pathKey}/${turnId}/`;
		for (const [blockKey, block] of [...this.openBlocks.entries()]) {
			if (!blockKey.startsWith(prefix)) {
				continue;
			}
			this.openBlocks.delete(blockKey);
			if (block.sink === undefined) {
					continue;
				}
			if (block.kind === "tool") {
					(block.sink as ToolSink).onClose(
						{ kind: "interrupted" },
						{ type: "tool", input: block.start?.input },
					);
					} else if (block.kind === "text") {
			(block.sink as TextSink).onClose(
				{ kind: "interrupted" },
				{ text: "" },
			);
					} else {
			(block.sink as ReasoningSink).onClose(
				{ kind: "interrupted" },
				{ reasoning: "" },
			);
					}
		}
	}

	private notifyIdle(): void {
		if (!this.idleNotified && this.openTurns.size === 0) {
			this.idleNotified = true;
			this.consumer.onIdle();
		}
	}
}
