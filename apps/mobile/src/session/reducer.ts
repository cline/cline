/**
 * Pure state machine + projection for one hub session.
 *
 * Zero React, zero I/O: `reduceSession` is a plain reducer and
 * `selectViewModel` derives the render-ready shape. `SessionConnection` owns the
 * socket and feeds actions in; anything the UI renders comes out of here, which
 * is what makes the ordering rules below testable against committed fixtures.
 *
 * ## Ordering contract
 *
 * `subscribe FIRST -> buffer -> hydrate -> merge -> live`. A client that
 * hydrates before subscribing loses every event published in between; one that
 * applies live events before the hydrate reply renders a transcript that the
 * reply then contradicts. So events that arrive while the hydrate is in flight
 * are buffered (`phase: "buffering"`) and only merged once the persisted
 * transcript is in hand.
 *
 * ## Merge rule
 *
 * The persisted transcript is authoritative for *finished* runs, and the hub
 * persists at assistant-message/turn boundaries, so:
 *
 * 1. Split buffered events into runs at each terminal event. Discard a completed
 *    run's assistant/reasoning content only when its text is already in a hydrated
 *    assistant message. A run can terminate after the snapshot was taken.
 *    Run status, usage, and approvals always apply.
 * 2. Replay events after the last terminal event in full.
 * 3. Dedupe tool events by toolCallId against hydrated tool_use ids.
 * 4. Reconcile optimistic user messages by new transcript occurrences, preserving
 *    failed sends when no previous transcript is known.
 * 5. `eventId` dedupe runs underneath all of the above.
 *
 * Re-hydration retains unpersisted assistant content while a run is active and
 * reconciles buffered events with the persisted transcript.
 *
 * ## Snapshots outrank memory
 *
 * Two pieces of state cannot be reconstructed from an event stream this client
 * may have missed, so the hub's snapshot replaces them outright rather than being
 * merged into them:
 *
 * - `runStatus` on `hydrated`, because a terminal run event published while the
 *   socket was down would otherwise leave the UI "running" forever.
 * - `pendingApprovals` on `approvals_recovered`, because an approval answered
 *   elsewhere is simply absent from the list, and merging would keep it on screen
 *   with no way for it to ever leave.
 *
 * Live events applied after the snapshot still win: they are strictly newer.
 */

import {
	type GeneratedMedia,
	type HubEventEnvelope,
	type PendingApprovalInfo,
	stripModeNotices,
	validateImageMedia,
} from "@cline/shared";
import { isInternalTranscriptMessage } from "./message-visibility";
import {
	type HydratedContentBlock,
	type HydratedMessage,
	type PendingPromptView,
	parseHubEvent,
	readSessionModel,
	type SessionEvent,
	type SessionModelView,
	type SessionQuestionView,
	type TokenUsagePayload,
	toPendingPromptView,
} from "./schemas";

// --- view model --------------------------------------------------------------

export type RunStatus = "idle" | "running" | "completed" | "aborted" | "failed";

export type ConnectionStatus =
	| "idle"
	| "connecting"
	| "hydrating"
	| "live"
	| "reconnecting"
	| "closed"
	/** The session cannot be driven: the hub refused to let this client attach. */
	| "error";

export type ToolActivityState = "running" | "completed" | "failed";

export type MessageBlock =
	| { kind: "text"; text: string }
	| { kind: "media"; media: GeneratedMedia }
	| {
			kind: "reasoning";
			text: string;
			redacted: boolean;
			startedAt?: number;
			completedAt?: number;
	  }
	| {
			kind: "tool";
			toolCallId: string;
			name: string;
			state: ToolActivityState;
			input?: unknown;
			output?: unknown;
			error?: string;
			startedAt?: number;
			completedAt?: number;
	  };

export interface SessionMessageView {
	/** Stable within a view: `h<n>` hydrated, `a<n>` live turn, `u<n>` optimistic. */
	id: string;
	role: "user" | "assistant";
	/** Display-only persisted failures stay distinct from assistant answers. */
	displayRole?: "error";
	/** Runtime-generated context remains canonical history, but has no chat row. */
	hidden?: true;
	blocks: MessageBlock[];
	origin: "hydrated" | "live";
	/** Epoch ms when this turn was observed, when the protocol/persistence had it. */
	createdAt?: number;
	/** Set on an optimistic user message not yet reflected by a hydrate. */
	pending?: true;
	/**
	 * Set when the last delivery attempt for this optimistic message failed. The
	 * message stays `pending` (the transcript still does not contain it), so the UI
	 * can offer a retry instead of showing a bubble that never settles.
	 */
	failed?: true;
	/** Why the last delivery attempt failed. Only set with {@link failed}. */
	error?: string;
}

export interface TokenUsageView {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

export interface SessionCounters {
	/** Event names outside protocol v1. */
	unknownEvents: number;
	/** Known events whose payload failed validation. */
	invalidEvents: number;
	/** Events re-delivered with an `eventId` already applied. */
	duplicateEvents: number;
	/** Protocol events this client deliberately does not project. */
	ignoredEvents: number;
	/** Buffered events dropped because the hydrate already reflected them. */
	reflectedBufferedEvents: number;
}

export interface LastRunView {
	startedAt?: number;
	endedAt?: number;
	outcome?: "completed" | "aborted" | "failed";
}

export interface SessionViewModel {
	/** A live run is waiting for its next output, not already streaming/blocked. */
	awaitingOutput?: boolean;
	connectionStatus: ConnectionStatus;
	runStatus: RunStatus;
	messages: SessionMessageView[];
	usage: { turns: TokenUsageView[]; total?: TokenUsageView };
	pendingApprovals: PendingApprovalInfo[];
	/** Clarifying questions raised by this session's client-owned executor. */
	pendingQuestions: SessionQuestionView[];
	/** A previously visible question was cancelled by a transport disconnect. */
	questionInterrupted?: true;
	/** The machine's turn queue: prompts sent while a run was active. */
	pendingPrompts: PendingPromptView[];
	/** Provider/model the session runs with, when the hub has said. */
	model?: SessionModelView;
	/** Timing/outcome of the most recent run this client watched, live only. */
	lastRun?: LastRunView;
	counters: SessionCounters;
	lastError?: string;
}

// --- diagnostics -------------------------------------------------------------

export type SessionDiagnostic =
	| { level: "warn"; type: "unknown_event"; event: string }
	| {
			level: "warn";
			type: "invalid_event_payload";
			event: string;
			detail: string;
	  }
	| { level: "warn"; type: "invalid_hydrate_payload"; detail: string }
	/** Individual transcript entries skipped; the rest of the transcript is intact. */
	| {
			level: "warn";
			type: "invalid_hydrate_entries";
			count: number;
			detail: string;
	  }
	| { level: "warn"; type: "invalid_pending_approvals"; count: number }
	| { level: "warn"; type: "transport_dropped"; detail: string }
	/**
	 * Events arrived on the socket before this connection knew which inner session
	 * it owns, and the hold buffer overflowed. Only reachable when the hub
	 * broadcasts another client's traffic to us; see
	 * `SessionConnection.holdUnscopedEvent`.
	 */
	| { level: "warn"; type: "unowned_events_dropped"; count: number }
	| { level: "info"; type: "approval_already_resolved"; approvalId: string }
	| { level: "info"; type: "resynced" }
	| { level: "error"; type: "hydrate_failed"; detail: string }
	| { level: "error"; type: "attach_failed"; detail: string }
	| {
			level: "warn" | "error";
			type: "command_failed";
			command: string;
			detail: string;
	  };

// --- state -------------------------------------------------------------------

export type SessionAction =
	| { type: "pending_prompts_recovered"; prompts: PendingPromptView[] }
	| { type: "connection_status"; status: ConnectionStatus }
	/** Subscription is live; start buffering until the hydrate reply lands. */
	| { type: "hydrate_started" }
	| {
			type: "hydrated";
			messages: HydratedMessage[];
			/**
			 * Run status as the hub reported it alongside the transcript. Applied
			 * before the buffered events are replayed, so live events still win.
			 */
			runStatus?: RunStatus;
	  }
	| { type: "hydrate_failed"; detail: string }
	/** The hub refused to let this client act on the session. Terminal. */
	| { type: "attach_failed"; detail: string }
	| { type: "event"; envelope: HubEventEnvelope }
	/** Model reported by a `session.attach`/`session.get` reply. */
	| { type: "model_updated"; model: SessionModelView }
	/** Opens the recovery window: live approval events are buffered from here. */
	| { type: "approvals_recovery_started" }
	| {
			type: "approvals_recovered";
			approvals: PendingApprovalInfo[];
			/** Clock for the expiry filter; defaults to `Date.now()`. */
			now?: number;
			/**
			 * The `approvalRecoveryGeneration` this reply belongs to. A mismatch means
			 * a newer recovery has since opened and this snapshot is stale, so it is
			 * discarded. Omitted only by tests that drive the reducer directly.
			 */
			generation?: number;
	  }
	/** Recovery round trip failed (e.g. malformed reply): keep the pending set. */
	| { type: "approvals_recovery_failed"; generation?: number }
	| {
			type: "approval_dropped";
			approvalId: string;
			reason: "already_resolved";
	  }
	| { type: "question_requested"; question: SessionQuestionView }
	| { type: "question_resolved"; requestId: string }
	| {
			type: "user_input";
			text: string;
			userImages?: string[];
			timestamp?: number;
	  }
	| { type: "send_failed"; messageId: string; detail: string }
	| { type: "send_queued"; messageId: string }
	| { type: "send_retried"; messageId: string }
	| { type: "transport_dropped"; detail: string; clearApprovals?: boolean }
	| { type: "diagnostic"; diagnostic: SessionDiagnostic };

interface InternalMessage extends SessionMessageView {
	/** Tool blocks by call id, so late `tool.*` events land on the right block. */
	toolIndex: Record<string, number>;
	/**
	 * The text block currently receiving one provider content segment. Completed
	 * segments keep their own blocks when this segment's authoritative
	 * `assistant.finished` text replaces its streamed deltas.
	 */
	activeTextSegment?: { blockIndex: number };
	activeReasoningSegment?: boolean;
}

/**
 * A live approval event observed while an `approval.list_pending` recovery is in
 * flight. These are replayed *on top of* the recovered snapshot by approvalId so
 * that ordering wins over the snapshot: the snapshot is authoritative only as of
 * its capture, and any requested/resolved the client saw during the round trip is
 * strictly newer for that id.
 */
type ApprovalRecoveryEvent =
	| { kind: "requested"; approval: PendingApprovalInfo }
	| { kind: "resolved"; approvalId: string };

/**
 * The `eventId` dedupe window.
 *
 * A flat array scanned with `includes` and copied per event costs O(window) twice
 * on the hottest path there is (`assistant.delta` on a phone). This keeps the
 * reducer purely immutable — no shared mutable Set that a branched state could
 * alias — while paying the O(window) copy only once per {@link SEAL_EVERY}
 * events: ids accumulate in a short `head` array and are sealed into a frozen
 * `Set` generation when it fills. Lookups are `head` (short scan) plus a handful
 * of O(1) `Set.has` probes.
 */
interface SeenEvents {
	/** Sealed generations, newest first. Never mutated after creation. */
	sealed: readonly ReadonlySet<string>[];
	/** Ids seen since the last seal. */
	head: readonly string[];
}

export interface SessionState {
	phase: "idle" | "buffering" | "live";
	connectionStatus: ConnectionStatus;
	runStatus: RunStatus;
	hydrated: InternalMessage[];
	/**
	 * Has a hydrate ever actually delivered a transcript?
	 *
	 * `hydrated: []` is ambiguous — a brand-new session and a session whose first
	 * hydrate failed look identical — and the optimistic count-delta needs to tell
	 * them apart. See {@link retainLive}.
	 */
	transcriptKnown: boolean;
	/** Live tail: optimistic user messages plus turns built from events. */
	live: InternalMessage[];
	buffer: HubEventEnvelope[];
	seenEventIds: SeenEvents;
	pendingApprovals: PendingApprovalInfo[];
	pendingQuestions: SessionQuestionView[];
	questionInterrupted?: true;
	pendingPrompts: PendingPromptView[];
	model?: SessionModelView;
	lastRun?: LastRunView;
	/**
	 * Live approval events buffered while a recovery round trip is open, or
	 * `undefined` when no recovery is in flight. Reconciled against the snapshot
	 * on `approvals_recovered`; cleared on `approvals_recovery_failed`.
	 */
	approvalRecovery?: ApprovalRecoveryEvent[];
	/**
	 * Monotonic id of the newest `approvals_recovery_started`. A reply carrying an
	 * older generation is from a superseded round trip and is discarded, so a stale
	 * `approval.list_pending` snapshot cannot resurrect a resolved approval or drop
	 * one raised while it was in flight.
	 */
	approvalRecoveryGeneration: number;
	usageTurns: TokenUsageView[];
	usageTotal?: TokenUsageView;
	counters: SessionCounters;
	hydratedToolCallIds: string[];
	turnSeq: number;
	inputSeq: number;
	lastError?: string;
	/** Diagnostics produced by the action that created this state, only. */
	emitted: SessionDiagnostic[];
}

/** Ids buffered in `head` before they are sealed into a generation. */
const SEAL_EVERY = 250;

/**
 * Sealed generations retained. With {@link SEAL_EVERY} this bounds the dedupe
 * window at 2000-2250 ids — a session's event ids are not worth unbounded RAM.
 */
const MAX_SEALED_GENERATIONS = 8;

const TERMINAL_RUN_EVENTS = new Set([
	"run.completed",
	"run.aborted",
	"run.failed",
]);

/**
 * Content events that the persisted transcript can supersede. Tool events are
 * excluded on purpose: they are deduped by `toolCallId` instead, which works in
 * both the reflected and the live window.
 */
const SUPERSEDABLE_CONTENT_EVENTS = new Set([
	"assistant.delta",
	"assistant.finished",
	"reasoning.delta",
	"reasoning.finished",
]);

export function createSessionState(): SessionState {
	return {
		phase: "idle",
		connectionStatus: "idle",
		runStatus: "idle",
		hydrated: [],
		transcriptKnown: false,
		live: [],
		buffer: [],
		seenEventIds: { sealed: [], head: [] },
		pendingApprovals: [],
		pendingQuestions: [],
		pendingPrompts: [],
		approvalRecoveryGeneration: 0,
		usageTurns: [],
		counters: {
			unknownEvents: 0,
			invalidEvents: 0,
			duplicateEvents: 0,
			ignoredEvents: 0,
			reflectedBufferedEvents: 0,
		},
		hydratedToolCallIds: [],
		turnSeq: 0,
		inputSeq: 0,
		emitted: [],
	};
}

export function reduceSession(
	state: SessionState,
	action: SessionAction,
): SessionState {
	const base: SessionState = { ...state, emitted: [] };
	switch (action.type) {
		case "pending_prompts_recovered":
			return { ...base, pendingPrompts: action.prompts };
		case "question_requested":
			return {
				...base,
				questionInterrupted: undefined,
				pendingQuestions: [
					...base.pendingQuestions.filter(
						(question) => question.requestId !== action.question.requestId,
					),
					action.question,
				],
			};
		case "question_resolved":
			return {
				...base,
				pendingQuestions: base.pendingQuestions.filter(
					(question) => question.requestId !== action.requestId,
				),
			};
		case "model_updated":
			return { ...state, model: action.model };
		case "connection_status":
			return { ...base, connectionStatus: action.status };
		case "hydrate_started":
			return {
				...base,
				phase: "buffering",
				connectionStatus: "hydrating",
				buffer: [],
			};
		case "hydrated":
			return applyHydrate(base, action.messages, action.runStatus);
		case "hydrate_failed":
			// A failed hydrate must not strand the client in `buffering` forever:
			// flush the buffered events as live and carry on with what we have.
			return {
				...applyHydrateFailure(base),
				emitted: [
					{ level: "error", type: "hydrate_failed", detail: action.detail },
				],
			};
		case "attach_failed":
			// Same rule as a failed hydrate for the buffer — the events are real even
			// if the session is unusable — but the connection state is terminal.
			return {
				...applyHydrateFailure(base),
				connectionStatus: "error",
				lastError: action.detail,
				emitted: [
					{ level: "error", type: "attach_failed", detail: action.detail },
				],
			};
		case "event":
			return applyIncomingEvent(base, action.envelope);
		case "approvals_recovery_started":
			// Open a *fenced* window. Discarding the previous window's buffered events
			// is only sound if the previous round trip can no longer land, so the
			// generation is bumped and its reply is ignored on arrival. Without the
			// fence a slow `approval.list_pending` could return after this window
			// opened and both resurrect an approval resolved in the meantime and drop
			// one raised inside the window — leaving a run blocked on nothing.
			return {
				...base,
				approvalRecovery: [],
				approvalRecoveryGeneration: base.approvalRecoveryGeneration + 1,
			};
		case "approvals_recovered":
			if (
				action.generation !== undefined &&
				action.generation !== base.approvalRecoveryGeneration
			) {
				// A superseded round trip. Its snapshot is older than the window that is
				// currently open, so applying it would move the pending set backwards.
				return { ...base, emitted: [] };
			}
			// `approval.list_pending` is authoritative *as of its capture*: an approval
			// answered while this client was away is absent from it, so the snapshot
			// replaces the pending set. But a requested/resolved the client observed
			// live during the round trip is strictly newer for that id, so it is
			// replayed on top — otherwise the older snapshot would wipe a live-arrived
			// approval or resurrect a live-resolved one.
			return {
				...base,
				pendingApprovals: reconcileRecoveredApprovals(
					action.approvals,
					base.approvalRecovery ?? [],
					action.now ?? Date.now(),
				),
				approvalRecovery: undefined,
			};
		case "approvals_recovery_failed":
			// A thrown/malformed reply must not wipe the pending set or crash the
			// connection: keep what we have and just close the window. A superseded
			// generation leaves the newer window open.
			if (
				action.generation !== undefined &&
				action.generation !== base.approvalRecoveryGeneration
			) {
				return { ...base, emitted: [] };
			}
			return { ...base, approvalRecovery: undefined };
		case "approval_dropped":
			return {
				...base,
				pendingApprovals: base.pendingApprovals.filter(
					(entry) => entry.approvalId !== action.approvalId,
				),
				emitted: [
					{
						level: "info",
						type: "approval_already_resolved",
						approvalId: action.approvalId,
					},
				],
			};
		case "user_input":
			return applyUserInput(
				{ ...base, questionInterrupted: undefined },
				action.text,
				action.userImages,
				action.timestamp,
			);
		case "send_queued":
			// The hub owns this input now. Only its queue row should be shown until
			// submission; retaining the original bubble would survive edits/deletion.
			return {
				...base,
				live: base.live.filter((message) => message.id !== action.messageId),
			};
		case "send_failed":
			return updateOptimisticMessage(base, action.messageId, (message) => ({
				...message,
				failed: true,
				error: action.detail,
			}));
		case "send_retried":
			return updateOptimisticMessage(base, action.messageId, (message) => {
				const { failed: _failed, error: _error, ...rest } = message;
				return rest;
			});
		case "transport_dropped":
			return {
				...base,
				phase: "idle",
				connectionStatus: "reconnecting",
				pendingApprovals: action.clearApprovals ? [] : base.pendingApprovals,
				// The hub cancels client-owned capability requests when the socket
				// disconnects, so keeping one visible would submit to a dead request id.
				pendingQuestions: [],
				questionInterrupted:
					base.pendingQuestions.length > 0 || base.questionInterrupted
						? true
						: undefined,
				emitted: [
					{ level: "warn", type: "transport_dropped", detail: action.detail },
				],
			};
		case "diagnostic":
			return { ...base, emitted: [action.diagnostic] };
	}
}

// --- hydrate + merge ---------------------------------------------------------

function applyHydrate(
	state: SessionState,
	messages: HydratedMessage[],
	authoritativeRunStatus?: RunStatus,
): SessionState {
	const projected = projectHydratedMessages(messages);
	const runStatus = authoritativeRunStatus ?? state.runStatus;
	const retainedLive = retainLive(state, projected, runStatus === "running");
	const superseded = supersededBufferedEvents(state.buffer, projected.messages);

	let next: SessionState = {
		...state,
		phase: "live",
		connectionStatus: "live",
		// The snapshot is the only source that can walk a stale `running` back after a
		// terminal event was published while this client was not listening. It is
		// applied *before* the buffered replay below, so anything the stream knows
		// still overrides it.
		runStatus,
		hydrated: projected.messages,
		transcriptKnown: true,
		hydratedToolCallIds: projected.toolCallIds,
		live: retainedLive,
		buffer: [],
	};

	const emitted: SessionDiagnostic[] = [];
	for (const [index, envelope] of state.buffer.entries()) {
		next = applyBufferedEvent(next, envelope, superseded[index] === true);
		emitted.push(...next.emitted);
	}
	return { ...next, emitted };
}

/**
 * Which buffered events the persisted transcript has already captured, decided
 * **per run** rather than once for the whole window.
 *
 * The window is cut into segments at every terminal run event. A segment that
 * ends in one is a candidate for having been persisted, and is discarded only if
 * the transcript demonstrably contains what it streamed. Trailing events after
 * the last terminal belong to a run still in flight, so they are never superseded.
 *
 * Deciding this once for the whole window — from the *last* `assistant.finished`
 * in it — silently discarded the earlier turn whenever two runs terminated inside
 * one hydrate window and only the later one had been persisted.
 */
function supersededBufferedEvents(
	buffered: readonly HubEventEnvelope[],
	hydrated: InternalMessage[],
): boolean[] {
	const superseded = new Array<boolean>(buffered.length).fill(false);
	let segmentStart = 0;
	for (const [index, envelope] of buffered.entries()) {
		if (!TERMINAL_RUN_EVENTS.has(envelope.event)) {
			continue;
		}
		const segment = buffered.slice(segmentStart, index + 1);
		if (isStreamedContentInTranscript(segment, hydrated)) {
			for (let position = segmentStart; position <= index; position += 1) {
				superseded[position] = true;
			}
		}
		segmentStart = index + 1;
	}
	return superseded;
}

/**
 * Decides what survives in the live tail across a hydrate, in arrival order.
 *
 * Two kinds of thing live there and each has its own rule.
 *
 * ## Optimistic user sends
 *
 * Reconciliation is by *count delta* against the previous hydrate, not text-set
 * membership: a send is dropped only when the transcript gained a matching
 * occurrence since the last hydrate, and each gain reconciles at most one send.
 * This stops a fresh "continue" from being erased just because an earlier
 * identical "continue" is already persisted (delta would be zero).
 *
 * Delivered (non-`failed`) sends are reconciled before `failed` ones, so when
 * identical sends land together and only some failed, the delta accounts for the
 * delivered ones first and the failed ones survive to stay retryable. A `failed`
 * send is therefore only dropped when the transcript genuinely gained an
 * occurrence beyond what the delivered sends explain — the "the reply was lost
 * but the send actually landed" case.
 *
 * The delta needs a *known* previous transcript. Until `transcriptKnown` there is
 * none — `hydrated: []` after a failed first hydrate means "not seen", not
 * "empty" — and every historical occurrence would otherwise read as newly gained,
 * silently dropping a `failed` send that never reached the hub. So on the first
 * successful hydrate `failed` sends take no budget at all: never dropping a
 * failed send is the invariant, and a duplicate retryable bubble is the safe
 * direction.
 *
 * ## Assistant turns rebuilt from events
 *
 * Kept only while the run they belong to is still in flight, and only until the
 * snapshot supersedes them. Deltas are never re-delivered and an in-flight run is
 * not persisted yet, so replacing the live tail wholesale erased the partial
 * answer on screen for good on a mid-run reconnect. A turn is superseded when its
 * text is already inside a hydrated assistant message, or (for a tool-only turn)
 * when every one of its tool calls is in the snapshot.
 *
 * `runInFlight` is the discriminator that keeps this from fighting the
 * "snapshots outrank memory" rule at the top of the file: once the hub says the
 * run is not running, the persisted transcript is authoritative for it and any
 * leftover live turn is stale, whether or not its text happens to appear there.
 *
 * Residual limit: without a per-send correlation token in the protocol, sends
 * with identical text are interchangeable — if two identical delivered sends are
 * pending and only one lands, the delta reconciles one arbitrarily; likewise the
 * delivered-before-failed ordering is a heuristic, not a guarantee of identity.
 * And a `failed` send that *had* landed before the first successful hydrate keeps
 * a stale retryable bubble until a later hydrate gains an occurrence for it.
 */
function retainLive(
	state: SessionState,
	projected: { messages: InternalMessage[]; toolCallIds: string[] },
	runInFlight: boolean,
): InternalMessage[] {
	const hydrated = projected.messages;
	const previousCounts = state.transcriptKnown
		? countUserTexts(state.hydrated)
		: new Map<string, number>();
	const currentCounts = countUserTexts(hydrated);
	// Reconciliation budget per text: how many new occurrences the transcript
	// gained since the previous hydrate.
	const budget = new Map<string, number>();
	for (const [text, count] of currentCounts) {
		const delta = count - (previousCounts.get(text) ?? 0);
		if (delta > 0) {
			budget.set(text, delta);
		}
	}

	const candidates = state.live.filter(
		(message) => message.role === "user" && message.pending === true,
	);
	const reconciled = new Set<InternalMessage>();
	// Two passes over the same budget: delivered sends claim it first so a failed
	// duplicate is never dropped while a delivered duplicate is still pending.
	// Without a known baseline the failed pass is skipped entirely.
	const passes = state.transcriptKnown ? [false, true] : [false];
	for (const wantFailed of passes) {
		for (const message of candidates) {
			if ((message.failed === true) !== wantFailed) {
				continue;
			}
			const text = comparableUserText(message);
			const remaining = budget.get(text) ?? 0;
			if (text.length > 0 && remaining > 0) {
				budget.set(text, remaining - 1);
				reconciled.add(message);
			}
		}
	}

	const snapshotToolCallIds = new Set(projected.toolCallIds);
	return state.live.filter((message) => {
		if (message.role === "user" && message.pending === true) {
			return !reconciled.has(message);
		}
		if (message.role !== "assistant" || !runInFlight) {
			return false;
		}
		return !isTurnInTranscript(message, hydrated, snapshotToolCallIds);
	});
}

/** Has the persisted snapshot taken over everything this live turn was showing? */
function isTurnInTranscript(
	turn: InternalMessage,
	hydrated: InternalMessage[],
	snapshotToolCallIds: ReadonlySet<string>,
): boolean {
	if (turn.blocks.length === 0) {
		// Nothing to lose, and keeping it would leave an empty bubble on screen.
		return true;
	}
	const text = plainText(turn);
	if (text.length > 0) {
		return hydrated.some(
			(message) =>
				!message.hidden &&
				message.role === "assistant" &&
				plainText(message).includes(text),
		);
	}
	const toolCallIds = turn.blocks.flatMap((block) =>
		block.kind === "tool" ? [block.toolCallId] : [],
	);
	return (
		toolCallIds.length > 0 &&
		toolCallIds.every((toolCallId) => snapshotToolCallIds.has(toolCallId))
	);
}

function countUserTexts(messages: InternalMessage[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const message of messages) {
		if (message.role !== "user" || message.hidden) {
			continue;
		}
		const text = comparableUserText(message);
		if (text.length === 0) {
			continue;
		}
		counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	return counts;
}

// Persisted turns carry the runtime's user-input envelope while the optimistic
// bubble contains only what the person typed. Reconciliation compares their
// human-authored bodies; the transcript itself remains untouched for rendering.
const USER_INPUT_ENVELOPE_RE = /^<user_input\b[^>]*>([\s\S]*)<\/user_input>$/i;

function comparableUserText(message: SessionMessageView): string {
	const text = plainText(message);
	const body = USER_INPUT_ENVELOPE_RE.exec(text)?.[1];
	return stripModeNotices(body ?? text).trim();
}

/**
 * Did the hydrated transcript already capture what these buffered events
 * streamed? Streaming after a reconnect resumes mid-message, so the streamed
 * text is a *suffix* of the persisted assistant message rather than equal to it.
 */
function isStreamedContentInTranscript(
	buffered: HubEventEnvelope[],
	hydrated: InternalMessage[],
): boolean {
	const streamed = streamedTextOf(buffered);
	if (!streamed) {
		return false;
	}
	return hydrated.some(
		(message) =>
			!message.hidden &&
			message.role === "assistant" &&
			plainText(message).includes(streamed),
	);
}

function streamedTextOf(buffered: HubEventEnvelope[]): string {
	let finished: string | undefined;
	let deltas = "";
	for (const envelope of buffered) {
		const parsed = parseHubEvent(envelope);
		if (parsed.status !== "ok") {
			continue;
		}
		if (
			parsed.event.name === "assistant.finished" &&
			parsed.event.payload.text
		) {
			finished = parsed.event.payload.text;
		}
		if (parsed.event.name === "assistant.delta") {
			deltas += parsed.event.payload.text;
		}
	}
	return (finished ?? deltas).trim();
}

function applyHydrateFailure(state: SessionState): SessionState {
	const buffered = state.buffer;
	let next: SessionState = {
		...state,
		phase: "live",
		connectionStatus: "live",
		buffer: [],
	};
	for (const envelope of buffered) {
		next = applyBufferedEvent(next, envelope, false);
	}
	return next;
}

function applyBufferedEvent(
	state: SessionState,
	envelope: HubEventEnvelope,
	supersededByHydrate: boolean,
): SessionState {
	if (supersededByHydrate && SUPERSEDABLE_CONTENT_EVENTS.has(envelope.event)) {
		return {
			...state,
			counters: {
				...state.counters,
				reflectedBufferedEvents: state.counters.reflectedBufferedEvents + 1,
			},
			emitted: [],
		};
	}
	return applyIncomingEvent(state, envelope);
}

// --- events ------------------------------------------------------------------

function applyIncomingEvent(
	state: SessionState,
	envelope: HubEventEnvelope,
): SessionState {
	if (state.phase === "buffering") {
		return { ...state, buffer: [...state.buffer, envelope], emitted: [] };
	}
	// Pending approvals are replayed with their original event ID after a drop.
	// Their approval ID merges rows while allowing the current set to rebuild.
	const eventId =
		envelope.event === "approval.requested" ? undefined : envelope.eventId;
	if (eventId && hasSeenEvent(state.seenEventIds, eventId)) {
		return {
			...state,
			counters: {
				...state.counters,
				duplicateEvents: state.counters.duplicateEvents + 1,
			},
			emitted: [],
		};
	}
	const parsed = parseHubEvent(envelope);
	if (parsed.status === "ignored") {
		return {
			...state,
			counters: {
				...state.counters,
				ignoredEvents: state.counters.ignoredEvents + 1,
			},
			emitted: [],
		};
	}
	if (parsed.status === "unknown") {
		return {
			...state,
			counters: {
				...state.counters,
				unknownEvents: state.counters.unknownEvents + 1,
			},
			emitted: [{ level: "warn", type: "unknown_event", event: parsed.event }],
		};
	}
	if (parsed.status === "invalid") {
		return {
			...state,
			counters: {
				...state.counters,
				invalidEvents: state.counters.invalidEvents + 1,
			},
			emitted: [
				{
					level: "warn",
					type: "invalid_event_payload",
					event: parsed.event,
					detail: parsed.detail,
				},
			],
		};
	}
	const withEventId = eventId
		? { ...state, seenEventIds: rememberEventId(state.seenEventIds, eventId) }
		: state;
	return applySessionEvent(withEventId, parsed.event);
}

function hasSeenEvent(seen: SeenEvents, eventId: string): boolean {
	if (seen.head.includes(eventId)) {
		return true;
	}
	for (const generation of seen.sealed) {
		if (generation.has(eventId)) {
			return true;
		}
	}
	return false;
}

function rememberEventId(seen: SeenEvents, eventId: string): SeenEvents {
	const head = [...seen.head, eventId];
	if (head.length < SEAL_EVERY) {
		return { sealed: seen.sealed, head };
	}
	return {
		sealed: [new Set(head), ...seen.sealed].slice(0, MAX_SEALED_GENERATIONS),
		head: [],
	};
}

function finishLastRun(
	lastRun: LastRunView | undefined,
	outcome: NonNullable<LastRunView["outcome"]>,
	timestamp: number | undefined,
): LastRunView {
	return {
		...(lastRun ?? {}),
		...(timestamp !== undefined ? { endedAt: timestamp } : {}),
		outcome,
	};
}

function applySessionEvent(
	state: SessionState,
	event: SessionEvent,
): SessionState {
	// Production hub events are epoch milliseconds. Contract fixtures use zero as
	// a deterministic placeholder; do not turn that into a visible Jan 1, 1970.
	const timestamp =
		event.timestamp !== undefined && event.timestamp > 0
			? event.timestamp
			: undefined;
	switch (event.name) {
		case "run.started":
			return {
				...state,
				runStatus: "running",
				turnSeq: state.turnSeq + 1,
				live: [...state.live, createTurn(state.turnSeq + 1, timestamp)],
				lastError: undefined,
				// A fresh watch window: the previous run's outcome must not survive
				// into a card describing this one.
				lastRun: timestamp !== undefined ? { startedAt: timestamp } : undefined,
			};
		case "assistant.delta":
			return withCurrentTurn(state, (message) =>
				appendText(message, event.payload.text),
			);
		case "assistant.media":
			return withCurrentTurn(state, (message) => ({
				...message,
				blocks: [
					...message.blocks,
					{ kind: "media", media: event.payload.media },
				],
			}));
		case "assistant.finished":
			return withCurrentTurn(state, (message) =>
				finishText(message, event.payload.text ?? ""),
			);
		case "reasoning.delta":
			return withCurrentTurn(state, (message) =>
				appendReasoning(
					message,
					event.payload.text,
					event.payload.redacted === true,
					timestamp,
				),
			);
		case "reasoning.finished":
			return withCurrentTurn(state, (message) =>
				finishReasoning(message, event.payload.reasoning ?? "", timestamp),
			);
		case "tool.started":
			return applyToolEvent(state, {
				toolCallId: event.payload.toolCallId,
				name: event.payload.toolName,
				input: event.payload.input,
				state: "running",
				timestamp,
			});
		case "tool.updated":
			return applyToolEvent(state, {
				toolCallId: event.payload.toolCallId,
				name: event.payload.toolName,
				input: event.payload.input,
				output: event.payload.output,
				error: event.payload.error,
				state: event.payload.error ? "failed" : "running",
				timestamp,
			});
		case "tool.finished":
			return applyToolEvent(state, {
				toolCallId: event.payload.toolCallId,
				name: event.payload.toolName,
				output: event.payload.output,
				error: event.payload.error,
				state: event.payload.error ? "failed" : "completed",
				timestamp,
			});
		case "usage.updated":
			return applyUsage(state, event.payload);
		case "run.completed":
			return {
				...state,
				runStatus: "completed",
				lastRun: finishLastRun(state.lastRun, "completed", timestamp),
			};
		case "run.aborted":
			return {
				...state,
				runStatus: "aborted",
				lastRun: finishLastRun(state.lastRun, "aborted", timestamp),
			};
		case "run.failed":
			return {
				...state,
				runStatus: "failed",
				lastError: event.payload.error ?? event.payload.reason ?? "run failed",
				lastRun: finishLastRun(state.lastRun, "failed", timestamp),
			};
		case "approval.requested": {
			const approval = event.payload as unknown as PendingApprovalInfo;
			return {
				...state,
				pendingApprovals: mergeApprovals(state, [approval]),
				approvalRecovery: recordRecoveryEvent(state.approvalRecovery, {
					kind: "requested",
					approval,
				}),
			};
		}
		case "approval.resolved":
			return {
				...state,
				pendingApprovals: state.pendingApprovals.filter(
					(entry) => entry.approvalId !== event.payload.approvalId,
				),
				approvalRecovery: recordRecoveryEvent(state.approvalRecovery, {
					kind: "resolved",
					approvalId: event.payload.approvalId,
				}),
			};
		// The record rides the event; a model change made from ANY client (the
		// terminal, another phone, this one) lands here so every view converges.
		// `readSessionModel` returns undefined when the record names nothing, and
		// nothing must not erase a model we already know.
		case "session.updated": {
			const model = readSessionModel(event.payload.session);
			if (!model) {
				return state;
			}
			return { ...state, model };
		}
		// A snapshot of the whole queue, so replace rather than merge — the hub
		// re-broadcasts the full list on every enqueue, edit, removal and drain.
		case "session.pending_prompts":
			return {
				...state,
				pendingPrompts: event.payload.prompts.map(toPendingPromptView),
			};
		// The entry became a real turn; its text arrives separately as the user
		// message, so dropping it here is what stops it being shown twice.
		case "session.pending_prompt_submitted":
			return {
				...state,
				pendingPrompts: state.pendingPrompts.filter(
					(entry) => entry.id !== event.payload.prompt.id,
				),
			};
	}
}

/**
 * Appends a live approval event to the open recovery window, or returns the
 * window unchanged when no recovery is in flight (`undefined`).
 */
function recordRecoveryEvent(
	window: ApprovalRecoveryEvent[] | undefined,
	event: ApprovalRecoveryEvent,
): ApprovalRecoveryEvent[] | undefined {
	if (window === undefined) {
		return undefined;
	}
	return [...window, event];
}

/**
 * Folds the recovered snapshot with the live events observed during the round
 * trip. The snapshot seeds the set; each buffered event is then applied in
 * arrival order by approvalId, so a requested-after-snapshot survives and a
 * resolved-during-recovery stays gone regardless of how the snapshot raced.
 */
function reconcileRecoveredApprovals(
	snapshot: PendingApprovalInfo[],
	window: ApprovalRecoveryEvent[],
	now: number,
): PendingApprovalInfo[] {
	const byId = new Map<string, PendingApprovalInfo>();
	// Already-expired entries are dropped: the hub sweeps them too, but a list
	// fetched moments before the sweep would otherwise render an approval whose
	// answer can only ever be refused.
	for (const approval of snapshot) {
		if (approval.expiresAt !== undefined && approval.expiresAt <= now) {
			continue;
		}
		byId.set(approval.approvalId, approval);
	}
	for (const event of window) {
		if (event.kind === "resolved") {
			byId.delete(event.approvalId);
			continue;
		}
		if (
			event.approval.expiresAt !== undefined &&
			event.approval.expiresAt <= now
		) {
			continue;
		}
		byId.set(event.approval.approvalId, event.approval);
	}
	return sortApprovals([...byId.values()]);
}

function mergeApprovals(
	state: SessionState,
	incoming: PendingApprovalInfo[],
): PendingApprovalInfo[] {
	const byId = new Map(
		state.pendingApprovals.map((entry) => [entry.approvalId, entry]),
	);
	for (const approval of incoming) {
		byId.set(approval.approvalId, approval);
	}
	return sortApprovals([...byId.values()]);
}

function sortApprovals(
	approvals: PendingApprovalInfo[],
): PendingApprovalInfo[] {
	return approvals.sort((left, right) => {
		if (left.createdAt !== right.createdAt) {
			return left.createdAt - right.createdAt;
		}
		return left.approvalId < right.approvalId ? -1 : 1;
	});
}

function applyUsage(
	state: SessionState,
	payload: {
		delta?: TokenUsagePayload;
		totals?: TokenUsagePayload;
		usage?: TokenUsagePayload;
		aggregateUsage?: TokenUsagePayload;
	},
): SessionState {
	// One entry per turn. `turnSeq - 1` clamps to 0 so usage seen before any
	// `run.started` (a client that joined mid-run) still lands on a turn, and
	// earlier turns we never saw usage for stay zeroed rather than sparse.
	const index = Math.max(0, state.turnSeq - 1);
	const turns = Array.from(
		{ length: Math.max(state.usageTurns.length, index + 1) },
		(_, position) => state.usageTurns[position] ?? emptyUsage(),
	);
	// `delta` is per-iteration and accumulates. A bare `usage` is *not*: it was
	// being both added to the turn and used as the absolute total, so a hub that
	// reports cumulative figures under `usage` inflated the turn without bound
	// (10, then 30, showed 40). With no `delta` field to disambiguate, the only
	// bounded reading is "this restates the turn's usage so far", so it replaces
	// rather than accumulates. A hub whose bare `usage` really is a per-iteration
	// delta under-reports the turn instead of running away, and should send
	// `delta`/`totals`.
	if (payload.delta) {
		turns[index] = addUsage(turns[index], toUsageView(payload.delta));
	} else if (payload.usage) {
		turns[index] = toUsageView(payload.usage);
	}
	const total = payload.totals ?? payload.aggregateUsage ?? payload.usage;
	return {
		...state,
		usageTurns: turns,
		...(total ? { usageTotal: toUsageView(total) } : {}),
	};
}

function emptyUsage(): TokenUsageView {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
	};
}

function toUsageView(payload: TokenUsagePayload | undefined): TokenUsageView {
	return {
		inputTokens: payload?.inputTokens ?? 0,
		outputTokens: payload?.outputTokens ?? 0,
		cacheReadTokens: payload?.cacheReadTokens ?? 0,
		cacheWriteTokens: payload?.cacheWriteTokens ?? 0,
		totalCost: payload?.totalCost ?? 0,
	};
}

function addUsage(
	current: TokenUsageView | undefined,
	delta: TokenUsageView,
): TokenUsageView {
	const base = current ?? emptyUsage();
	return {
		inputTokens: base.inputTokens + delta.inputTokens,
		outputTokens: base.outputTokens + delta.outputTokens,
		cacheReadTokens: base.cacheReadTokens + delta.cacheReadTokens,
		cacheWriteTokens: base.cacheWriteTokens + delta.cacheWriteTokens,
		totalCost: base.totalCost + delta.totalCost,
	};
}

// --- live turn construction --------------------------------------------------

function createTurn(turnSeq: number, createdAt?: number): InternalMessage {
	return {
		id: `a${turnSeq}`,
		role: "assistant",
		origin: "live",
		...(createdAt === undefined ? {} : { createdAt }),
		blocks: [],
		toolIndex: {},
	};
}

/**
 * Content can arrive without a preceding `run.started` — a client that connects
 * mid-run, or the recovery path where the first thing we see is `tool.finished`.
 * Opening a turn on demand is what keeps those transcripts renderable.
 */
function withCurrentTurn(
	state: SessionState,
	update: (message: InternalMessage) => InternalMessage,
): SessionState {
	const lastIndex = state.live.length - 1;
	const last = state.live[lastIndex];
	if (last && last.role === "assistant") {
		const live = [...state.live];
		live[lastIndex] = update(last);
		return { ...state, live };
	}
	const turnSeq = state.turnSeq + 1;
	return {
		...state,
		turnSeq,
		live: [...state.live, update(createTurn(turnSeq))],
	};
}

function appendText(message: InternalMessage, text: string): InternalMessage {
	const blocks = [...message.blocks];
	const last = blocks[blocks.length - 1];
	const active = message.activeTextSegment;
	if (
		active &&
		active.blockIndex === blocks.length - 1 &&
		last?.kind === "text"
	) {
		blocks[active.blockIndex] = { kind: "text", text: last.text + text };
		return { ...message, blocks };
	}
	// A finished segment is its own paragraph, even when the next segment
	// immediately follows it without a tool/reasoning block in between.
	blocks.push({ kind: "text", text });
	return {
		...message,
		blocks,
		activeTextSegment: { blockIndex: blocks.length - 1 },
	};
}

function finishText(message: InternalMessage, text: string): InternalMessage {
	const blocks = [...message.blocks];
	const last = blocks[blocks.length - 1];
	const active = message.activeTextSegment;
	if (
		active &&
		active.blockIndex === blocks.length - 1 &&
		last?.kind === "text"
	) {
		// `assistant.finished` is authoritative for THIS content segment, not for
		// earlier segments already committed into the same assistant turn.
		// A reconnect can lose the previous segment's `assistant.finished` while
		// preserving its deltas. If the next segment's authoritative text is already
		// the suffix of what we rendered, replacing the accumulated segment
		// would erase the earlier segment. Keeping the accumulated text is both
		// idempotent for the normal delta+finished case and lossless after a drop.
		blocks[active.blockIndex] = {
			kind: "text",
			text: text && last.text.endsWith(text) ? last.text : text || last.text,
		};
	} else if (text) {
		blocks.push({ kind: "text", text });
	}
	return { ...message, blocks, activeTextSegment: undefined };
}

function appendReasoning(
	message: InternalMessage,
	text: string,
	redacted: boolean,
	timestamp?: number,
): InternalMessage {
	const blocks = [...message.blocks];
	const last = blocks[blocks.length - 1];
	if (last?.kind === "reasoning") {
		blocks[blocks.length - 1] = {
			kind: "reasoning",
			text: last.text + text,
			redacted: last.redacted || redacted,
			...(last.startedAt === undefined && timestamp !== undefined
				? { startedAt: timestamp }
				: last.startedAt === undefined
					? {}
					: { startedAt: last.startedAt }),
		};
	} else {
		blocks.push({
			kind: "reasoning",
			text,
			redacted,
			...(timestamp === undefined ? {} : { startedAt: timestamp }),
		});
	}
	return { ...message, blocks, activeReasoningSegment: true };
}

function finishReasoning(
	message: InternalMessage,
	text: string,
	timestamp?: number,
): InternalMessage {
	const blocks = [...message.blocks];
	const last = blocks[blocks.length - 1];
	if (last?.kind === "reasoning") {
		blocks[blocks.length - 1] = {
			kind: "reasoning",
			text: text || last.text,
			redacted: last.redacted,
			...(last.startedAt === undefined ? {} : { startedAt: last.startedAt }),
			...(timestamp === undefined ? {} : { completedAt: timestamp }),
		};
	} else if (text) {
		blocks.push({
			kind: "reasoning",
			text,
			redacted: false,
			...(timestamp === undefined ? {} : { completedAt: timestamp }),
		});
	}
	return { ...message, blocks, activeReasoningSegment: false };
}

interface ToolUpdate {
	toolCallId?: string;
	name?: string;
	state: ToolActivityState;
	input?: unknown;
	output?: unknown;
	error?: string;
	timestamp?: number;
}

/**
 * Picks the block key for a tool event that carries no `toolCallId` (the
 * projector's hook branch publishes only a name).
 *
 * A bare `hook:${name}` merged *every* invocation of that hook in a turn into one
 * block, so a formatter that ran twice showed only the second result. Instead the
 * key is reused only while the block for it is still `running`, i.e. for the
 * start/finish pair of one invocation; the next invocation gets a fresh suffix.
 */
function syntheticToolCallId(message: InternalMessage, name: string): string {
	const prefix = `hook:${name}`;
	for (let attempt = 0; ; attempt += 1) {
		const key = attempt === 0 ? prefix : `${prefix}#${attempt}`;
		const index = message.toolIndex[key];
		if (index === undefined) {
			return key;
		}
		const block = message.blocks[index];
		if (block?.kind === "tool" && block.state === "running") {
			return key;
		}
	}
}

function applyToolEvent(state: SessionState, update: ToolUpdate): SessionState {
	const name = update.name ?? "tool";
	// Only real `tool_use` ids can appear in the snapshot, so the reflected-event
	// check is skipped for synthesized hook keys.
	if (
		update.toolCallId !== undefined &&
		state.hydratedToolCallIds.includes(update.toolCallId)
	) {
		return {
			...state,
			counters: {
				...state.counters,
				reflectedBufferedEvents: state.counters.reflectedBufferedEvents + 1,
			},
		};
	}
	return withCurrentTurn(state, (message) => {
		const toolCallId = update.toolCallId ?? syntheticToolCallId(message, name);
		const existingIndex = message.toolIndex[toolCallId];
		const blocks = [...message.blocks];
		const existing =
			existingIndex === undefined ? undefined : blocks[existingIndex];
		if (existingIndex !== undefined && existing?.kind === "tool") {
			// Follow-up events only carry what changed, so anything they leave out
			// keeps the value the block already had — and a terminal state is never
			// walked back to `running` by a late `tool.updated`.
			const input = update.input !== undefined ? update.input : existing.input;
			const output =
				update.output !== undefined ? update.output : existing.output;
			const error = update.error ?? existing.error;
			blocks[existingIndex] = {
				kind: "tool",
				toolCallId,
				name: update.name ?? existing.name,
				state:
					update.state === "running" && existing.state !== "running"
						? existing.state
						: update.state,
				...(input === undefined ? {} : { input }),
				...(output === undefined ? {} : { output }),
				...(error === undefined ? {} : { error }),
				...(existing.startedAt === undefined
					? update.state === "running" && update.timestamp !== undefined
						? { startedAt: update.timestamp }
						: {}
					: { startedAt: existing.startedAt }),
				...(update.state === "running" || update.timestamp === undefined
					? existing.completedAt === undefined
						? {}
						: { completedAt: existing.completedAt }
					: { completedAt: update.timestamp }),
			};
			return { ...message, blocks };
		}
		blocks.push({
			kind: "tool",
			toolCallId,
			name,
			state: update.state,
			...(update.input === undefined ? {} : { input: update.input }),
			...(update.output === undefined ? {} : { output: update.output }),
			...(update.error === undefined ? {} : { error: update.error }),
			...(update.state === "running" && update.timestamp !== undefined
				? { startedAt: update.timestamp }
				: {}),
			...(update.state !== "running" && update.timestamp !== undefined
				? { completedAt: update.timestamp }
				: {}),
		});
		return {
			...message,
			blocks,
			toolIndex: { ...message.toolIndex, [toolCallId]: blocks.length - 1 },
		};
	});
}

/** The view-model id of the `n`th optimistic user message. */
export function optimisticMessageId(inputSeq: number): string {
	return `u${inputSeq}`;
}

function applyUserInput(
	state: SessionState,
	text: string,
	userImages?: string[],
	timestamp?: number,
): SessionState {
	const inputSeq = state.inputSeq + 1;
	const mediaBlocks: MessageBlock[] = [];
	for (const [index, image] of (userImages ?? []).entries()) {
		const validated = validateImageMedia(undefined, image);
		if (!validated.ok) continue;
		mediaBlocks.push({
			kind: "media",
			media: {
				id: `user-image-${inputSeq}-${index}`,
				modality: "image",
				mediaType: validated.mediaType,
				source: { type: "base64", data: validated.base64 },
				sizeBytes: validated.decodedBytes,
			},
		});
	}
	return {
		...state,
		inputSeq,
		live: [
			...state.live,
			{
				id: optimisticMessageId(inputSeq),
				role: "user",
				origin: "live",
				...(timestamp === undefined ? {} : { createdAt: timestamp }),
				pending: true,
				blocks: [{ kind: "text", text }, ...mediaBlocks],
				toolIndex: {},
			},
		],
	};
}

/**
 * Applies `update` to one optimistic user message. A message the transcript has
 * already reconciled is simply gone, and an update aimed at it is a no-op rather
 * than an error: the send it belonged to was resolved by the hydrate.
 */
function updateOptimisticMessage(
	state: SessionState,
	messageId: string,
	update: (message: InternalMessage) => InternalMessage,
): SessionState {
	const index = state.live.findIndex(
		(message) => message.id === messageId && message.pending === true,
	);
	if (index < 0) {
		return state;
	}
	const live = [...state.live];
	const target = live[index];
	if (!target) {
		return state;
	}
	live[index] = update(target);
	return { ...state, live };
}

/**
 * The text of a failed optimistic send, for {@link SessionConnection.retrySend}.
 * `undefined` for anything that is not retryable — a message that never failed,
 * or one the transcript has already caught up with.
 */
export function selectOptimisticSend(
	state: SessionState,
	messageId: string,
): string | undefined {
	const message = state.live.find(
		(entry) =>
			entry.id === messageId &&
			entry.pending === true &&
			entry.failed === true &&
			entry.role === "user",
	);
	if (!message) {
		return undefined;
	}
	const text = plainText(message);
	return text.length > 0 ? text : undefined;
}

/** Full retry payload, including image blocks kept in the optimistic bubble. */
export function selectOptimisticInput(
	state: SessionState,
	messageId: string,
): { text: string; userImages?: string[] } | undefined {
	const text = selectOptimisticSend(state, messageId);
	if (text === undefined) return undefined;
	const message = state.live.find((entry) => entry.id === messageId);
	const userImages = message?.blocks.flatMap((block) => {
		if (
			block.kind !== "media" ||
			block.media.modality !== "image" ||
			block.media.source.type !== "base64"
		) {
			return [];
		}
		return [`data:${block.media.mediaType};base64,${block.media.source.data}`];
	});
	return {
		text,
		...(userImages?.length ? { userImages } : {}),
	};
}

// --- hydrate projection ------------------------------------------------------

interface HydrateProjection {
	messages: InternalMessage[];
	toolCallIds: string[];
}

/**
 * Projects persisted LLM messages onto the same block vocabulary the live stream
 * produces. `tool_result` blocks are folded into the `tool_use` block they
 * answer, so a tool call renders as one activity row rather than a call in one
 * message and an opaque result in the next.
 */
function projectHydratedMessages(
	messages: HydratedMessage[],
): HydrateProjection {
	const results = new Map<
		string,
		{ output?: unknown; isError: boolean; name?: string }
	>();
	for (const message of messages) {
		if (typeof message.content === "string") {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_result") {
				const result = block as Extract<
					HydratedContentBlock,
					{ type: "tool_result" }
				>;
				results.set(result.tool_use_id, {
					output: result.content,
					isError: result.is_error === true,
					name: result.name,
				});
			}
		}
	}

	const projected: InternalMessage[] = [];
	const toolCallIds: string[] = [];
	for (const message of messages) {
		const blocks: MessageBlock[] = [];
		const toolIndex: Record<string, number> = {};
		if (typeof message.content === "string") {
			if (message.content) {
				blocks.push({ kind: "text", text: message.content });
			}
		} else {
			for (const block of message.content) {
				switch (block.type) {
					case "text":
						if (block.text) {
							blocks.push({ kind: "text", text: block.text });
						}
						break;
					case "image":
						blocks.push({
							kind: "media",
							media: {
								id: `hydrated-image-${projected.length}-${blocks.length}`,
								modality: "image",
								mediaType: block.mediaType ?? "image/png",
								source: { type: "base64", data: block.data },
							},
						});
						break;
					case "media":
						blocks.push({ kind: "media", media: block.media });
						break;
					case "file":
						blocks.push({
							kind: "media",
							media: {
								id: `hydrated-file-${projected.length}-${blocks.length}`,
								modality: "file",
								mediaType: "application/octet-stream",
								...(block.path ? { name: block.path.split("/").at(-1) } : {}),
								source: { type: "base64", data: block.content },
							},
						});
						break;
					case "thinking":
						blocks.push({
							kind: "reasoning",
							text: block.thinking,
							redacted: false,
						});
						break;
					case "redacted_thinking":
						blocks.push({ kind: "reasoning", text: "", redacted: true });
						break;
					case "tool_use": {
						const result = results.get(block.id);
						toolCallIds.push(block.id);
						toolIndex[block.id] = blocks.length;
						blocks.push({
							kind: "tool",
							toolCallId: block.id,
							name: block.name,
							state: result
								? result.isError
									? "failed"
									: "completed"
								: "running",
							...(block.input === undefined ? {} : { input: block.input }),
							...(result?.output === undefined
								? {}
								: result.isError
									? { error: String(result.output) }
									: { output: result.output }),
						});
						break;
					}
					default:
						// `tool_result` is folded above; unknown blocks stay unsupported.
						break;
				}
			}
		}
		if (blocks.length === 0) {
			// A user message that carried only tool results is not a chat turn.
			continue;
		}
		projected.push({
			id: `h${projected.length}`,
			role: message.role,
			...(isInternalTranscriptMessage(message)
				? { hidden: true as const }
				: {}),
			...(message.role === "assistant" &&
			message.metadata !== null &&
			typeof message.metadata === "object" &&
			"displayRole" in message.metadata &&
			message.metadata.displayRole === "error"
				? { displayRole: "error" as const }
				: {}),
			origin: "hydrated",
			...(message.createdAt === undefined
				? {}
				: { createdAt: message.createdAt }),
			blocks,
			toolIndex,
		});
	}
	return { messages: projected, toolCallIds };
}

// --- projection --------------------------------------------------------------

function plainText(message: SessionMessageView): string {
	return message.blocks
		.filter(
			(block): block is Extract<MessageBlock, { kind: "text" }> =>
				block.kind === "text",
		)
		.map((block) => block.text)
		.join("")
		.trim();
}

function toMessageView(message: InternalMessage): SessionMessageView {
	return {
		id: message.id,
		role: message.role,
		...(message.hidden ? { hidden: true as const } : {}),
		...(message.displayRole ? { displayRole: message.displayRole } : {}),
		origin: message.origin,
		...(message.createdAt === undefined
			? {}
			: { createdAt: message.createdAt }),
		...(message.pending ? { pending: true as const } : {}),
		...(message.failed ? { failed: true as const } : {}),
		...(message.error === undefined ? {} : { error: message.error }),
		blocks: message.blocks,
	};
}

export function selectViewModel(state: SessionState): SessionViewModel {
	// An optimistic follow-up can be appended while the assistant is still
	// working. It must not hide that turn's streaming/tool activity.
	const current =
		state.live.findLast((message) => message.role === "assistant") ??
		state.hydrated.findLast((message) => message.role === "assistant");
	const tail = current?.blocks.at(-1);
	const streaming =
		current?.role === "assistant" &&
		((tail?.kind === "text" &&
			current.activeTextSegment?.blockIndex === current.blocks.length - 1) ||
			(tail?.kind === "reasoning" && current.activeReasoningSegment === true));
	const awaitingOutput =
		state.runStatus === "running" &&
		!streaming &&
		!current?.blocks.some(
			(block) => block.kind === "tool" && block.state === "running",
		) &&
		!state.pendingApprovals.length &&
		!state.pendingQuestions.length &&
		!state.lastError;
	const messages = [...state.hydrated, ...state.live]
		.filter((message) => message.blocks.length > 0)
		.map(toMessageView);
	return {
		connectionStatus: state.connectionStatus,
		...(awaitingOutput ? { awaitingOutput: true } : {}),
		runStatus: state.runStatus,
		messages,
		usage: {
			turns: state.usageTurns,
			...(state.usageTotal ? { total: state.usageTotal } : {}),
		},
		pendingApprovals: state.pendingApprovals,
		pendingQuestions: state.pendingQuestions,
		...(state.questionInterrupted
			? { questionInterrupted: true as const }
			: {}),
		pendingPrompts: state.pendingPrompts,
		...(state.model ? { model: state.model } : {}),
		...(state.lastRun ? { lastRun: state.lastRun } : {}),
		counters: state.counters,
		...(state.lastError ? { lastError: state.lastError } : {}),
	};
}
