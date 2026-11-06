/**
 * v2 frame schema — the wire representation of the agent event stream.
 *
 * Design: `@cline/core/docs/agent-event-stream-design.md`. A frame is a
 * scoped, sequenced lifecycle/payload datum: every frame names exactly
 * one scope (session, turn, or block), and the per-scope projections of
 * a frame stream each form a small regular language (see
 * `validateFrameStream`).
 *
 * `epoch` is the conversation/replica fence (task switch, cancel,
 * reinit) — bumped by the host via the framer's `bumpEpoch()`, never by
 * the run itself. `seq` is monotonic per producer stream and survives
 * runs, so reconnect/resume can request "everything after seq N".
 */
export const FRAME_SCHEMA_VERSION = 2;

// =============================================================================
// Scope address
// =============================================================================

export interface FrameScope {
	/** Root agent first, owning agent last (e.g. ["root", "agent-3f"]). */
	agentPath: string[];
	/** Present on turn- and block-scoped frames. */
	turnId?: string;
	/** Present on block-scoped frames. For tools this is the toolCallId. */
	blockId?: string;
}

// =============================================================================
// Errors and outcomes
// =============================================================================

/**
 * Structured, serializable error (design P7). Replaces the JS `Error`
 * that `AgentErrorEvent` carries, which cannot cross a wire and which
 * every serializing boundary currently flattens differently.
 */
export interface StreamError {
	code: string;
	message: string;
	/** Provider error classification when known (AgentErrorEvent.errorClass). */
	providerErrorClass?: string;
	/** Structured provider details when available (e.g. a JSON error body). */
	details?: unknown;
}

/** Handle to out-of-stream work (design: scope tree, "detach"). */
export interface ResourceRef {
	/** What kind of thing survives the scope (a log file, a runId). */
	kind: "file" | "run";
	/** Where to find it: a path, an id in another subsystem. */
	ref: string;
}

export type Outcome =
	| { kind: "completed" }
	| { kind: "error"; error: StreamError }
	| { kind: "interrupted" }
	| { kind: "detached"; resource: ResourceRef };

// =============================================================================
// Frame bodies (discriminated on `kind`)
// =============================================================================

export interface TurnStart {
	turnId: string;
}

export interface TextStart {
	blockId: string;
}

export interface ReasoningStart {
	blockId: string;
	/** Whether this block's reasoning is redacted (from content_start). */
	redacted: boolean;
}

export interface ToolStart {
	blockId: string;
	toolName: string;
	input: unknown;
	/** Where a model tool is executed; absent for ordinary local tools. */
	execution?: "client" | "provider";
}

export interface MediaStart {
	blockId: string;
}

export type OpenBody =
	| { kind: "open"; openKind: "turn"; start: TurnStart }
	| { kind: "open"; openKind: "text"; start: TextStart }
	| { kind: "open"; openKind: "reasoning"; start: ReasoningStart }
	| { kind: "open"; openKind: "tool"; start: ToolStart }
	| { kind: "open"; openKind: "media"; start: MediaStart };

export type DeltaBody =
	| { kind: "delta"; payload: { type: "text"; text: string } }
	| { kind: "delta"; payload: { type: "reasoning"; reasoning: string } }
	| { kind: "delta"; payload: { type: "tool"; update: unknown } };

/**
 * Authoritative final content. Always carries the open's data for tools
 * (input), so consumers never carry state from open to close (design P3).
 * Absent on turn closes, which carry only the outcome.
 */
export type CloseFinal =
	| { type: "text"; text: string }
	| { type: "reasoning"; reasoning: string }
	| { type: "tool"; input: unknown; output?: unknown; error?: StreamError; durationMs?: number }
	| { type: "media"; media: unknown };

export interface CloseBody {
	kind: "close";
	outcome: Outcome;
	final?: CloseFinal;
}

/** Turn-scoped notices: recovery, status, and the v1 iteration markers. */
export interface NoticeBody {
	kind: "notice";
	noticeType:
		| "recovery"
		| "stop"
		| "status"
		| "iteration_started"
		| "iteration_finished";
	/** Iteration number for the iteration_* markers. */
	iteration?: number;
	hadToolCalls?: boolean;
	toolCallCount?: number;
	message?: string;
	displayRole?: "system" | "status";
	reason?: string;
}

export interface UsageBody {
	kind: "usage";
	/** Delta usage for the turn so far (v1 `usage` event fields). */
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	cost?: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens?: number;
	totalCacheWriteTokens?: number;
	totalCost?: number;
}

/**
 * Namespaced, typed data attached to a scope by a non-agent producer
 * (approval coordinator, checkpoint tracker). Closed union at schema
 * level; unknown namespaces decode as `{ ns: "unknown", raw }`.
 * Emitted from Phase 2+; declared here so the wire contract is total.
 */
export type AnnotationBody =
	| { kind: "annotation"; ns: "approval"; body: Record<string, unknown> }
	| { kind: "annotation"; ns: "checkpoint"; body: Record<string, unknown> }
	| { kind: "annotation"; ns: "hook"; body: Record<string, unknown> }
	| { kind: "annotation"; ns: "unknown"; raw: unknown };

/** Session-scoped list of open scopes, sent on attach/reconnect. Phase 2+. */
export interface SnapshotBody {
	kind: "snapshot";
	openScopes: Array<{
		scope: FrameScope;
		openKind: "turn" | "text" | "reasoning" | "tool" | "media" | "agent" | "run";
		start: unknown;
	}>;
}

export type FrameBody =
	| OpenBody
	| DeltaBody
	| CloseBody
	| NoticeBody
	| UsageBody
	| AnnotationBody
	| SnapshotBody;

// =============================================================================
// Envelope + frame
// =============================================================================

export interface FrameEnvelope {
	v: typeof FRAME_SCHEMA_VERSION;
	epoch: number;
	seq: number;
	scope: FrameScope;
}

export type StreamFrame = FrameEnvelope & FrameBody;

// =============================================================================
// Validator — per-scope projections of a frame stream
// =============================================================================

/** Frame seq must strictly increase; the stream is resumable after seq N. */
export const SEQ_NOT_INCREASING = "seq-not-increasing";
/** Epoch may not decrease within one stream. */
export const EPOCH_REGRESSION = "epoch-regression";
/** Wrong schema version. */
export const BAD_VERSION = "bad-version";
/** open(turn) while another turn is open. */
export const TURN_OVERLAP = "turn-overlap";
/** close(turn) with no matching open turn (also covers the double close). */
export const TURN_CLOSE_WITHOUT_OPEN = "turn-close-without-open";
/** close(turn) while child blocks of the turn are still open. */
export const TURN_CLOSE_WITH_OPEN_CHILDREN = "turn-close-with-open-children";
/** A block frame addressed to a turn that is not open. */
export const BLOCK_WITHOUT_TURN = "block-without-turn";
/** open(block) for a blockId that is already open. */
export const BLOCK_OPEN_WHILE_OPEN = "block-open-while-open";
/** delta for a blockId that is not open. */
export const BLOCK_DELTA_WITHOUT_OPEN = "block-delta-without-open";
/** close(block) for a blockId that is not open. */
export const BLOCK_CLOSE_WITHOUT_OPEN = "block-close-without-open";
/** Turn-scoped notice/usage with no open turn at that address. */
export const TURN_FRAME_WITHOUT_TURN = "turn-frame-without-turn";
/** Any frame after the session close. */
export const AFTER_SESSION_END = "after-session-end";
/** Annotation addressed to a scope never seen in this stream. */
export const ANNOTATION_UNKNOWN_SCOPE = "annotation-unknown-scope";
/** Address does not match the frame kind (missing turnId/blockId). */
export const BAD_SCOPE_ADDRESS = "bad-scope-address";

export type FrameViolationCode =
	| typeof SEQ_NOT_INCREASING
	| typeof EPOCH_REGRESSION
	| typeof BAD_VERSION
	| typeof TURN_OVERLAP
	| typeof TURN_CLOSE_WITHOUT_OPEN
	| typeof TURN_CLOSE_WITH_OPEN_CHILDREN
	| typeof BLOCK_WITHOUT_TURN
	| typeof BLOCK_OPEN_WHILE_OPEN
	| typeof BLOCK_DELTA_WITHOUT_OPEN
	| typeof BLOCK_CLOSE_WITHOUT_OPEN
	| typeof TURN_FRAME_WITHOUT_TURN
	| typeof AFTER_SESSION_END
	| typeof ANNOTATION_UNKNOWN_SCOPE
	| typeof BAD_SCOPE_ADDRESS;

export interface FrameViolation {
	code: FrameViolationCode;
	/** Index of the offending frame in the input. */
	index: number;
	/** Discriminant of the offending frame. */
	kind: StreamFrame["kind"];
	detail?: string;
}

export interface FrameValidationResult {
	violations: FrameViolation[];
	/** Blocks still open (empty for a well-formed terminated stream). */
	openBlocks: string[];
	openTurnId?: string;
	/** True when a session-scoped close frame was seen. */
	sessionEnded: boolean;
	frameCount: number;
}

/**
 * Validate a frame stream against the v2 tables.
 *
 * Like the v1 validator (`stream-grammar.ts`), this is a fold over
 * per-scope projections: every frame names exactly one scope, and each
 * scope's projection is a small regular language. A prefix is legal;
 * `openBlocks`/`openTurnId` report dangling scopes for debugging and
 * for reconnect snapshots. There is no wart registry in v2 — warts were
 * v1's structural deviations, and v2 makes them unrepresentable.
 */
export function validateFrameStream(
	frames: readonly StreamFrame[],
): FrameValidationResult {
	const violations: FrameViolation[] = [];
	const violation = (
		index: number,
		frame: StreamFrame,
		code: FrameViolationCode,
		detail?: string,
	): void => {
		violations.push({ code, index, kind: frame.kind, detail });
	};

	let lastSeq = 0;
	let lastEpoch = 0;
	let sessionEnded = false;
	let openTurnId: string | undefined;
	const openBlocks = new Map<string, string>(); // blockId -> owning turnId
	const knownBlocks = new Set<string>();
	const knownTurns = new Set<string>();

	for (let index = 0; index < frames.length; index += 1) {
		const frame = frames[index];
		if (frame.v !== FRAME_SCHEMA_VERSION) {
			violation(index, frame, BAD_VERSION);
			continue;
		}
		if (frame.epoch < lastEpoch) {
			violation(index, frame, EPOCH_REGRESSION);
		}
		lastEpoch = Math.max(lastEpoch, frame.epoch);
		if (frame.seq <= lastSeq) {
			violation(index, frame, SEQ_NOT_INCREASING);
		}
		lastSeq = Math.max(lastSeq, frame.seq);

		if (sessionEnded) {
			violation(index, frame, AFTER_SESSION_END);
			continue;
		}

		const turnId = frame.scope.turnId;
		const blockId = frame.scope.blockId;

		switch (frame.kind) {
			case "open": {
				if (frame.openKind === "turn") {
					if (turnId === undefined || blockId !== undefined) {
						violation(index, frame, BAD_SCOPE_ADDRESS);
						break;
					}
					if (openTurnId !== undefined) {
						violation(index, frame, TURN_OVERLAP, turnId);
						break;
					}
					openTurnId = turnId;
					knownTurns.add(turnId);
					break;
				}
				if (turnId === undefined || blockId === undefined) {
					violation(index, frame, BAD_SCOPE_ADDRESS);
					break;
				}
				if (openTurnId !== turnId) {
					violation(index, frame, BLOCK_WITHOUT_TURN, blockId);
					break;
				}
				if (openBlocks.has(blockId)) {
					violation(index, frame, BLOCK_OPEN_WHILE_OPEN, blockId);
					break;
				}
				openBlocks.set(blockId, turnId);
				knownBlocks.add(blockId);
				break;
			}
			case "delta": {
				if (turnId === undefined || blockId === undefined) {
					violation(index, frame, BAD_SCOPE_ADDRESS);
					break;
				}
				if (openTurnId !== turnId || !openBlocks.has(blockId)) {
					violation(index, frame, BLOCK_DELTA_WITHOUT_OPEN, blockId);
				}
				break;
			}
			case "close": {
				if (blockId !== undefined) {
					if (openBlocks.get(blockId) !== turnId) {
						violation(index, frame, BLOCK_CLOSE_WITHOUT_OPEN, blockId);
						break;
					}
					openBlocks.delete(blockId);
					break;
				}
				if (turnId !== undefined) {
					if (openTurnId !== turnId) {
						violation(index, frame, TURN_CLOSE_WITHOUT_OPEN, turnId);
						break;
					}
					const stragglers = [...openBlocks.entries()]
						.filter(([, owner]) => owner === turnId)
						.map(([id]) => id);
					if (stragglers.length > 0) {
						violation(
							index,
							frame,
							TURN_CLOSE_WITH_OPEN_CHILDREN,
							stragglers.join(","),
						);
					}
					openTurnId = undefined;
					break;
				}
				sessionEnded = true;
				break;
			}
			case "notice":
			case "usage": {
				if (turnId === undefined) {
					// Session-scoped notices are legal; usage is turn-scoped.
					if (frame.kind === "usage") {
						violation(index, frame, BAD_SCOPE_ADDRESS);
					}
					break;
				}
				if (openTurnId !== turnId) {
					violation(index, frame, TURN_FRAME_WITHOUT_TURN, turnId);
				}
				break;
			}
			case "annotation": {
				// Legal on open or closed scopes, but the scope must be one
				// this stream has seen (late annotations target real scopes).
				if (blockId !== undefined) {
					if (!knownBlocks.has(blockId)) {
						violation(index, frame, ANNOTATION_UNKNOWN_SCOPE, blockId);
					}
				} else if (turnId !== undefined && !knownTurns.has(turnId)) {
					violation(index, frame, ANNOTATION_UNKNOWN_SCOPE, turnId);
				}
				break;
			}
			case "snapshot": {
				// Session-scoped; contents are the producer's live set and
				// are diffed by the assembler, not validated here.
				if (turnId !== undefined || blockId !== undefined) {
					violation(index, frame, BAD_SCOPE_ADDRESS);
				}
				break;
			}
			default: {
				const _exhaustive: never = frame;
				void _exhaustive;
			}
		}
	}

	return {
		violations,
		openBlocks: [...openBlocks.keys()],
		openTurnId,
		sessionEnded,
		frameCount: frames.length,
	};
}

