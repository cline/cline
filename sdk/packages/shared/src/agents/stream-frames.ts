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

import type { ProviderErrorClass } from "../agent";

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
	providerErrorClass?: ProviderErrorClass;
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
	/**
	 * The v1 finish reason rides along on completed turns: `max_iterations`
	 * and `mistake_limit` also complete the turn, but consumers that vary
	 * behavior on the exact reason (the completion retag) must see it.
	 */
	| { kind: "completed"; finishReason?: "completed" | "max_iterations" | "mistake_limit" }
	| { kind: "error"; error: StreamError; /** Distinguishes the terminal
	 * `error` event (`"error"`) from `done(reason:"error")` (`"done"`):
	 * v1 finalizes a dangling compaction divider as "failed" for the
	 * former and "cancelled" for the latter, and only the former emits
	 * the api_req_failed pair. Always set on turn closes; tool closes
	 * carry no terminal distinction. */ via?: "error" | "done" }
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
	/**
	 * Turn closes only: the run's iteration count (from the v1 `done`
	 * event). Consumers render run summaries from it; block closes
	 * never carry it.
	 */
	iterations?: number;
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
	/** Producer metadata (e.g. compaction status payloads) that
	 * consumers parse for rich labels. */
	metadata?: Record<string, unknown>;
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
 * The user's decision on a tool block that required approval. Published
 * by the host's approval coordinator, addressed to the tool block, and
 * sequenced BEFORE the block's open: the runtime awaits approval before
 * it emits the tool start. Consumers therefore receive it from the
 * assembler together with the block's open.
 *
 * - `approved`: `messageTs` is the id of the approval prompt row the
 *   host rendered; a consumer that renders the tool as a row updates
 *   that row in place instead of adding a second one.
 * - `denied`: the block was never executed. The runtime still emits its
 *   open and an errored close carrying `reason`; consumers render
 *   neither.
 */
export type ApprovalAnnotation =
	| { state: "approved"; messageTs: number }
	| { state: "denied"; reason: string };

/**
 * Namespaced, typed data attached to a scope by a non-agent producer
 * (approval coordinator, checkpoint tracker). Closed union at schema
 * level; unknown namespaces decode as `{ ns: "unknown", raw }`.
 */
export type AnnotationBody =
	| { kind: "annotation"; ns: "approval"; body: ApprovalAnnotation }
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
/** Annotation addressed to a turn never seen in this stream. */
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
	/** Blocks still open (address keys: path#turn#block). */
	openBlocks: string[];
	/** Turns still open, one per agent path (address keys: path#turn). */
	openTurns: string[];
	/** True when a session-scoped close frame was seen. */
	sessionEnded: boolean;
	frameCount: number;
}

/**
 * Validate a frame stream against the v2 tables.
 *
 * Like the v1 validator (`stream-grammar.ts`), this is a fold over
 * per-scope projections — keyed by full scope address (agentPath,
 * turnId, blockId), because multiplexed agent streams each mint their
 * own `turn-1` and several turns can be open at once (one per agent
 * path). A prefix is legal; `openBlocks`/`openTurns` report dangling
 * scopes for debugging and reconnect snapshots. There is no wart
 * registry in v2 — warts were v1's structural deviations, and v2
 * makes them unrepresentable.
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
	// turnKey: `${agentPath joined}/${turnId}` -> turnId
	const openTurns = new Map<string, string>();
	const knownTurns = new Set<string>();
	// blockKey: `${agentPath joined}/${turnId}/${blockId}` -> turnKey
	const openBlocks = new Map<string, string>();

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

		const path = frame.scope.agentPath.join("/");
		const turnId = frame.scope.turnId;
		const blockId = frame.scope.blockId;
		const turnKey =
			turnId !== undefined ? `${path}/${turnId}` : undefined;
		const blockKey =
			turnId !== undefined && blockId !== undefined
				? `${path}/${turnId}/${blockId}`
				: undefined;

		switch (frame.kind) {
			case "open": {
				if (frame.openKind === "turn") {
					if (turnId === undefined || blockId !== undefined) {
						violation(index, frame, BAD_SCOPE_ADDRESS);
						break;
					}
					const key = `${path}/${turnId}`;
					if (openTurns.has(key)) {
						violation(index, frame, TURN_OVERLAP, key);
						break;
					}
					openTurns.set(key, turnId);
					knownTurns.add(key);
					break;
				}
				if (turnKey === undefined || blockKey === undefined) {
					violation(index, frame, BAD_SCOPE_ADDRESS);
					break;
				}
				if (!openTurns.has(turnKey)) {
					violation(index, frame, BLOCK_WITHOUT_TURN, blockKey);
					break;
				}
				if (openBlocks.has(blockKey)) {
					violation(index, frame, BLOCK_OPEN_WHILE_OPEN, blockKey);
					break;
				}
				openBlocks.set(blockKey, turnKey);
				break;
			}
			case "delta": {
				if (blockKey === undefined) {
					violation(index, frame, BAD_SCOPE_ADDRESS);
					break;
				}
				if (openBlocks.get(blockKey) !== turnKey) {
					violation(index, frame, BLOCK_DELTA_WITHOUT_OPEN, blockKey);
				}
				break;
			}
			case "close": {
				if (blockId !== undefined) {
					if (blockKey === undefined || openBlocks.get(blockKey) !== turnKey) {
						violation(index, frame, BLOCK_CLOSE_WITHOUT_OPEN, blockKey ?? blockId);
						break;
					}
					openBlocks.delete(blockKey);
					break;
				}
				if (turnId !== undefined) {
					if (turnKey === undefined || !openTurns.has(turnKey)) {
						violation(index, frame, TURN_CLOSE_WITHOUT_OPEN, turnKey ?? turnId);
						break;
					}
					const stragglers = [...openBlocks.entries()]
						.filter(([, owner]) => owner === turnKey)
						.map(([key]) => key);
					if (stragglers.length > 0) {
						violation(
							index,
							frame,
							TURN_CLOSE_WITH_OPEN_CHILDREN,
								stragglers.join(","),
							);
					}
					openTurns.delete(turnKey);
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
				if (turnKey === undefined || !openTurns.has(turnKey)) {
					violation(index, frame, TURN_FRAME_WITHOUT_TURN, turnKey);
				}
				break;
			}
			case "annotation": {
				// Legal before, during, or after the scope's lifetime: a
				// block annotation may precede the block's open (approval
				// is decided before the runtime starts the tool) or follow
				// its close (a checkpoint restore marks a finished edit).
				// The turn, however, must be one this stream has seen.
				if (turnKey !== undefined && !knownTurns.has(turnKey)) {
					violation(index, frame, ANNOTATION_UNKNOWN_SCOPE, turnKey);
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
		openTurns: [...openTurns.keys()],
		sessionEnded,
		frameCount: frames.length,
	};
}
