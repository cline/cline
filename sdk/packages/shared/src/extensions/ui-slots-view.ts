import {
	applyPluginUiState,
	type ComposerSuggestionItem,
	type ComposerSuggestionsState,
	comparePluginUiOrder,
	PLUGIN_UI_LIMITS,
	type PluginUiInvokeOutcome,
	type PluginUiInvokeResult,
	type PluginUiOrder,
	type PluginUiStateEnvelope,
	type PluginUiTone,
} from "./ui-slots";

export const SUGGESTION_EXPOSURE_MS = 400;
export const SUGGESTION_STALE_NOTE_MS = 4_000;
export const SUGGESTION_SEND_VERDICT_MS = 300;
/** An optimistic skip or refresh with no reply after this long is undone. */
export const SUGGESTION_PENDING_UNDO_MS = 2_000;
export const SUGGESTION_BREAKPOINTS = {
	/** px (0eebe5ba) */
	desktop: { narrowBelow: 520, compactBelow: 400 },
	/** px (f6c4aea8) */
	ide: { narrowBelow: 520, compactBelow: 280 },
	/** columns (ea57871f) */
	cli: { narrowBelow: 80, compactBelow: 60 },
} as const;

const EXPOSED_REVISIONS_KEPT = 32;
const REFRESHING_CUE_TEXT = "finding different suggestions…";

type SuggestionsEnvelope = PluginUiStateEnvelope<"composer.suggestions">;
type SuggestionCue = { text: string; tone: PluginUiTone };

/** Exported: hosts capture one at press time for a one-key Send. */
export type SuggestionRef = {
	itemId: string;
	revision: string;
	prompt: string;
	label: string;
	tone: PluginUiTone;
};

export interface SuggestionsLocal {
	/** The bound session, set by `bind`; a `state`, `reply` or `attached` for any other session is ignored. */
	sessionId?: string;
	envelope?: SuggestionsEnvelope;
	/** Order of the envelope on screen when the last run started: a ready/line state not newer than this is stale. */
	freshAfter?: PluginUiOrder;
	/** Epoch from the last attach reply that carried one; a newer envelope sets attachDue. */
	boundEpoch?: number;
	/**
	 * The last attach reply carried no epoch or timed out, so the viewer may
	 * never have reached the plugin: an envelope at or above `boundEpoch` sets
	 * attachDue too, and so does the next run end.
	 */
	attachUnconfirmed: boolean;
	attachDue: boolean;
	/** Highest epoch that has set attachDue, so a re-attach is due at most once per epoch even when its reply carries no epoch. */
	attachDueFor?: number;
	/** Epoch whose unconfirmed attach a run end already retried, so that retry happens once per epoch. */
	attachRetriedAfterRunFor?: number;
	highlightId?: string;
	used?: SuggestionRef;
	/** Carries the ItemRef so hosts can build `undo`. */
	sent?: SuggestionRef;
	/** Optimistic. */
	pendingSkipIds: readonly string[];
	/** Optimistic. */
	refreshing: boolean;
	/** When the oldest optimistic change (skip or refresh) was painted. */
	pendingSince?: number;
	collapsedRevision?: string;
	staleUntil?: number;
	/** When the derived view last became `ready` while on screen, or a new revision arrived there; unset whenever it is not. */
	readyAt?: number;
	/** Revisions this viewer already reported as exposed. Survives `bind`; bounded to the last 32. */
	exposedRevisions: ReadonlySet<string>;
}

export type SuggestionsLocalEvent =
	| { type: "bind"; sessionId: string }
	/** `sessionId`: the session the attach named; `outcome` and `epoch`: its reply's. */
	| {
			type: "attached";
			sessionId: string;
			outcome: PluginUiInvokeOutcome;
			epoch?: number;
	  }
	| { type: "state"; envelope: SuggestionsEnvelope; now: number }
	| { type: "run_started" }
	/** The run in progress ended; extensions are initialized by then. */
	| { type: "run_ended" }
	/** Host feedback: the derived mode is `ready` and the tray is on screen. */
	| { type: "view"; ready: boolean; now: number }
	| { type: "move"; delta: 1 | -1 }
	| { type: "highlight"; itemId: string }
	| { type: "used"; itemId: string }
	/** Esc on used text, or the box emptied. */
	| { type: "draft_cleared" }
	/** A used suggestion was submitted, or (with the ref captured at press time) a one-key Send. */
	| { type: "sent"; ref?: SuggestionRef }
	/** A queued sent suggestion was taken back into the box. */
	| { type: "unsent" }
	| { type: "skip_pending"; itemId: string; now: number }
	| { type: "refresh_pending"; now: number }
	/** `sessionId`: the session the invoke named. */
	| {
			type: "reply";
			sessionId: string;
			result: PluginUiInvokeResult<"composer.suggestions">;
			now: number;
	  }
	/** The host's timer fired for the earliest deadline. */
	| { type: "tick"; now: number }
	| { type: "collapse" }
	| { type: "exposed"; revision: string };

export interface SuggestionsHostFacts {
	draft: string;
	/** A run is in progress (any client's). */
	busy: boolean;
	/** Approval or question pending, slash/@/autocomplete menu or dialog open. */
	blocked: boolean;
	/** Prompts waiting in this session's queue. */
	queued: number;
	/** The host can take the sent prompt back: it is still queued, or a checkpoint or fork exists from before it. */
	canUndo: boolean;
	width: number;
	breakpoints: { narrowBelow: number; compactBelow: number };
	now: number;
}

export type SuggestionsDensity = "full" | "narrow" | "compact";
export type SuggestionSourcePlacement =
	| "inline"
	| "icon"
	| "in-detail"
	| "none";

export type SuggestionsView =
	| { mode: "hidden" }
	/** Busy, nothing sent from here, a plugin state is present (desktop draws skeleton slots). */
	| { mode: "working" }
	| { mode: "sent"; label: string; tone: PluginUiTone; canUndo: boolean }
	| { mode: "stale" }
	| { mode: "used"; label: string; tone: PluginUiTone; edited: boolean }
	| { mode: "yielded"; count: number; tones: PluginUiTone[] }
	/** hidden(user) with an empty box. */
	| { mode: "off"; title: string }
	| { mode: "loading"; title: string; cue?: SuggestionCue; rows: number }
	| {
			mode: "line";
			kind: "empty" | "exhausted" | "unavailable";
			title: string;
			note?: string;
	  }
	| { mode: "collapsed"; title: string; cue?: SuggestionCue; count: number }
	| {
			mode: "ready";
			density: SuggestionsDensity;
			title: string;
			cue?: SuggestionCue;
			rows: Array<{
				item: ComposerSuggestionItem;
				highlighted: boolean;
				source: SuggestionSourcePlacement;
			}>;
			highlighted: ComposerSuggestionItem;
			position: { index: number; count: number };
			/** Ready, fresh, empty draft, not busy, not blocked, nothing queued. */
			keysEnabled: boolean;
			/** keysEnabled, the highlighted row is sendable, and it has been on screen for SUGGESTION_EXPOSURE_MS. */
			canSend: boolean;
			/** "more" on the last visible row when a new set is available. */
			skipMeans: "skip" | "more";
			canRefresh: boolean;
	  };

export function createSuggestionsLocal(): SuggestionsLocal {
	return {
		attachUnconfirmed: false,
		attachDue: false,
		pendingSkipIds: [],
		refreshing: false,
		exposedRevisions: new Set(),
	};
}

function visibleItems(local: SuggestionsLocal): ComposerSuggestionItem[] {
	const items = local.envelope?.state?.items ?? [];
	return items.filter((item) => !local.pendingSkipIds.includes(item.id));
}

function highlightedIndex(
	rows: readonly ComposerSuggestionItem[],
	highlightId: string | undefined,
): number {
	return Math.max(
		0,
		rows.findIndex((item) => item.id === highlightId),
	);
}

/**
 * The sent line ends at the next set, when the plugin goes unavailable, or
 * when the tray is turned off. A cleared state (the plugin failed or was
 * disabled) ends it too, since no later set will.
 */
function endsSentLine(
	state: ComposerSuggestionsState | null,
	sentRevision: string,
): boolean {
	if (!state) return true;
	switch (state.status) {
		case "unavailable":
			return true;
		case "hidden":
			return state.hiddenReason === "user" || state.hiddenReason === "disabled";
		case "ready":
		case "empty":
		case "exhausted":
			return state.revision !== sentRevision;
		case "loading":
			return false;
	}
}

/**
 * At most once per epoch, and never before the first attach reply. An
 * unconfirmed attach re-attaches within its own epoch as well; an old hub
 * sends no envelopes, so that cannot loop.
 */
function makesAttachDue(local: SuggestionsLocal, epoch: number): boolean {
	if (epoch <= (local.attachDueFor ?? Number.NEGATIVE_INFINITY)) return false;
	if (local.attachUnconfirmed)
		return epoch >= (local.boundEpoch ?? Number.NEGATIVE_INFINITY);
	return local.boundEpoch !== undefined && epoch > local.boundEpoch;
}

/**
 * A timed-out attach can leave the plugin without its viewer while the
 * plugin's state is already held, so no later envelope makes a re-attach
 * due. A run cannot end before the session's extensions are initialized, so
 * its end retries the attach once per epoch.
 */
function retryAttachAfterRun(local: SuggestionsLocal): SuggestionsLocal {
	const epoch = local.boundEpoch ?? local.envelope?.epoch;
	if (
		!local.attachUnconfirmed ||
		local.attachDue ||
		epoch === undefined ||
		epoch === local.attachRetriedAfterRunFor
	)
		return local;
	return { ...local, attachDue: true, attachRetriedAfterRunFor: epoch };
}

function withoutOptimisticPaint(local: SuggestionsLocal): SuggestionsLocal {
	if (local.pendingSkipIds.length === 0 && !local.refreshing) return local;
	return { ...local, pendingSkipIds: [], refreshing: false };
}

/**
 * Applies a newer envelope. Optimistic paint referred to the set on screen, so
 * a new revision resolves it; within one revision only skipped rows the state
 * still carries stay pending. A new revision restarts the exposure clock at
 * its arrival when the tray was on screen.
 */
function applyEnvelope(
	local: SuggestionsLocal,
	envelope: SuggestionsEnvelope,
	now: number,
): SuggestionsLocal {
	if (envelope.sessionId !== local.sessionId) return local;
	const applied = applyPluginUiState(local.envelope, envelope);
	if (applied === local.envelope) return local;
	const next: SuggestionsLocal = { ...local, envelope: applied };
	if (makesAttachDue(local, applied.epoch)) {
		next.attachDue = true;
		next.attachDueFor = applied.epoch;
	}
	if (local.sent && endsSentLine(applied.state, local.sent.revision)) {
		next.sent = undefined;
	}
	if (applied.state?.revision !== local.envelope?.state?.revision) {
		next.readyAt = local.readyAt === undefined ? undefined : now;
		next.pendingSkipIds = [];
		next.refreshing = false;
		next.pendingSince = undefined;
		return next;
	}
	const itemIds = new Set(applied.state?.items.map((item) => item.id));
	next.pendingSkipIds = local.pendingSkipIds.filter((id) => itemIds.has(id));
	if (next.pendingSkipIds.length === 0 && !next.refreshing) {
		next.pendingSince = undefined;
	}
	return next;
}

function applyReply(
	local: SuggestionsLocal,
	event: Extract<SuggestionsLocalEvent, { type: "reply" }>,
): SuggestionsLocal {
	const { result } = event;
	if (event.sessionId !== local.sessionId) return local;
	if (result.state && result.state.sessionId !== local.sessionId) return local;
	let next = result.state
		? applyEnvelope(local, result.state, event.now)
		: local;
	switch (result.outcome) {
		case "ok":
			break;
		case "refused":
			next = {
				...withoutOptimisticPaint(next),
				staleUntil: event.now + SUGGESTION_STALE_NOTE_MS,
			};
			break;
		case "rejected":
		case "timeout":
			next = withoutOptimisticPaint(next);
			break;
		case "unavailable":
			next = withoutOptimisticPaint(next);
			if (!result.state && (next.envelope || next.sent))
				next = { ...next, envelope: undefined, sent: undefined };
			break;
	}
	return next.pendingSince === undefined
		? next
		: { ...next, pendingSince: undefined };
}

function refFor(
	local: SuggestionsLocal,
	itemId: string,
): SuggestionRef | undefined {
	const state = local.envelope?.state;
	const item = state?.items.find((candidate) => candidate.id === itemId);
	if (!state || !item) return undefined;
	return {
		itemId: item.id,
		revision: state.revision,
		prompt: item.prompt,
		label: item.label,
		tone: item.tone,
	};
}

/** Keeps the highlight in place when the highlighted row is skipped: the next row, or the previous one at the end. */
function highlightAfterSkip(
	local: SuggestionsLocal,
	itemId: string,
): string | undefined {
	const rows = visibleItems(local);
	const index = highlightedIndex(rows, local.highlightId);
	if (rows[index]?.id !== itemId) return local.highlightId;
	return (rows[index + 1] ?? rows[index - 1])?.id;
}

export function reduceSuggestionsLocal(
	local: SuggestionsLocal,
	event: SuggestionsLocalEvent,
): SuggestionsLocal {
	switch (event.type) {
		case "bind":
			return {
				...createSuggestionsLocal(),
				sessionId: event.sessionId,
				exposedRevisions: local.exposedRevisions,
			};
		case "attached": {
			if (event.sessionId !== local.sessionId) return local;
			const boundEpoch = event.epoch ?? local.boundEpoch;
			const attachUnconfirmed =
				event.epoch === undefined || event.outcome === "timeout";
			if (
				!local.attachDue &&
				boundEpoch === local.boundEpoch &&
				attachUnconfirmed === local.attachUnconfirmed
			)
				return local;
			return { ...local, boundEpoch, attachUnconfirmed, attachDue: false };
		}
		case "state":
			return applyEnvelope(local, event.envelope, event.now);
		case "reply":
			return applyReply(local, event);
		case "run_started": {
			const freshAfter = local.envelope
				? { epoch: local.envelope.epoch, seq: local.envelope.seq }
				: local.freshAfter;
			if (
				local.highlightId === undefined &&
				freshAfter?.epoch === local.freshAfter?.epoch &&
				freshAfter?.seq === local.freshAfter?.seq
			)
				return local;
			return { ...local, freshAfter, highlightId: undefined };
		}
		case "run_ended":
			return retryAttachAfterRun(local);
		case "view":
			if (event.ready)
				return local.readyAt === undefined
					? { ...local, readyAt: event.now }
					: local;
			return local.readyAt === undefined
				? local
				: { ...local, readyAt: undefined };
		case "move": {
			const rows = visibleItems(local);
			if (rows.length === 0) return local;
			const from = highlightedIndex(rows, local.highlightId);
			const to = (from + event.delta + rows.length) % rows.length;
			if (to === from) return local;
			return { ...local, highlightId: rows[to].id };
		}
		case "highlight":
			if (
				event.itemId === local.highlightId ||
				!visibleItems(local).some((item) => item.id === event.itemId)
			)
				return local;
			return { ...local, highlightId: event.itemId };
		case "used": {
			const used = refFor(local, event.itemId);
			return used ? { ...local, used, highlightId: event.itemId } : local;
		}
		case "draft_cleared":
			return local.used ? { ...local, used: undefined } : local;
		case "sent": {
			const sent = event.ref ?? local.used;
			return sent ? { ...local, sent, used: undefined } : local;
		}
		case "unsent":
			return local.sent
				? { ...local, used: local.sent, sent: undefined }
				: local;
		case "skip_pending":
			if (local.pendingSkipIds.includes(event.itemId)) return local;
			return {
				...local,
				highlightId: highlightAfterSkip(local, event.itemId),
				pendingSkipIds: [...local.pendingSkipIds, event.itemId],
				pendingSince: local.pendingSince ?? event.now,
			};
		case "refresh_pending":
			if (local.refreshing) return local;
			return {
				...local,
				refreshing: true,
				pendingSince: local.pendingSince ?? event.now,
			};
		case "tick":
			if (
				local.pendingSince === undefined ||
				event.now - local.pendingSince < SUGGESTION_PENDING_UNDO_MS
			)
				return local;
			return { ...withoutOptimisticPaint(local), pendingSince: undefined };
		case "collapse": {
			const revision = local.envelope?.state?.revision;
			if (revision === undefined || revision === local.collapsedRevision)
				return local;
			return { ...local, collapsedRevision: revision };
		}
		case "exposed": {
			if (local.exposedRevisions.has(event.revision)) return local;
			const kept = [...local.exposedRevisions, event.revision].slice(
				-EXPOSED_REVISIONS_KEPT,
			);
			return { ...local, exposedRevisions: new Set(kept) };
		}
	}
}

function densityFor(
	width: number,
	breakpoints: SuggestionsHostFacts["breakpoints"],
): SuggestionsDensity {
	if (width < breakpoints.compactBelow) return "compact";
	if (width < breakpoints.narrowBelow) return "narrow";
	return "full";
}

/** Narrow trays shrink a link to its icon; a plain label, which has no icon, moves into the why line instead. */
function sourcePlacement(
	item: ComposerSuggestionItem,
	density: SuggestionsDensity,
): SuggestionSourcePlacement {
	if (!item.source) return "none";
	if (density === "full") return "inline";
	if (density === "narrow" && item.source.url) return "icon";
	return "in-detail";
}

function isHiddenFor(
	state: ComposerSuggestionsState | null,
	reason: NonNullable<ComposerSuggestionsState["hiddenReason"]>,
): boolean {
	return state?.status === "hidden" && state.hiddenReason === reason;
}

function withCue(cue: SuggestionCue | undefined): { cue?: SuggestionCue } {
	return cue ? { cue } : {};
}

const HIDDEN_VIEW: SuggestionsView = { mode: "hidden" };

/** Pure in `host.now`. Precedence follows the shared renderer contract; the first match wins. */
export function deriveSuggestionsView(
	local: SuggestionsLocal,
	host: SuggestionsHostFacts,
): SuggestionsView {
	const envelope = local.envelope;
	const state = envelope?.state ?? null;
	const draftEmpty = host.draft === "";
	if (host.blocked) return HIDDEN_VIEW;
	if (
		local.sent &&
		(host.busy ||
			host.queued > 0 ||
			state?.status === "loading" ||
			isHiddenFor(state, "superseded"))
	)
		return {
			mode: "sent",
			label: local.sent.label,
			tone: local.sent.tone,
			canUndo: host.canUndo,
		};
	if (host.queued > 0) return HIDDEN_VIEW;
	if (
		host.busy &&
		state &&
		!isHiddenFor(state, "user") &&
		!isHiddenFor(state, "disabled")
	)
		return { mode: "working" };
	if (local.staleUntil !== undefined && local.staleUntil > host.now)
		return { mode: "stale" };
	if (local.used && !draftEmpty)
		return {
			mode: "used",
			label: local.used.label,
			tone: local.used.tone,
			edited: host.draft !== local.used.prompt,
		};
	if (!envelope || !state) return HIDDEN_VIEW;
	if (state.status === "hidden")
		return state.hiddenReason === "user" && draftEmpty
			? { mode: "off", title: state.title }
			: HIDDEN_VIEW;
	if (
		state.status !== "loading" &&
		local.freshAfter &&
		comparePluginUiOrder(envelope, local.freshAfter) <= 0
	)
		return HIDDEN_VIEW;
	const rows = visibleItems(local);
	if (!draftEmpty)
		return state.status === "ready" && rows.length > 0
			? {
					mode: "yielded",
					count: rows.length,
					tones: rows.map((item) => item.tone),
				}
			: HIDDEN_VIEW;
	if (
		state.status === "loading" ||
		local.refreshing ||
		(state.status === "ready" && rows.length === 0)
	)
		return {
			mode: "loading",
			title: state.title,
			...withCue(
				local.refreshing
					? { text: REFRESHING_CUE_TEXT, tone: state.cue?.tone ?? "neutral" }
					: state.cue,
			),
			rows: state.items.length || PLUGIN_UI_LIMITS.items,
		};
	if (state.status !== "ready")
		return {
			mode: "line",
			kind: state.status,
			title: state.title,
			...(state.note ? { note: state.note } : {}),
		};
	if (local.collapsedRevision === state.revision)
		return {
			mode: "collapsed",
			title: state.title,
			...withCue(state.cue),
			count: rows.length,
		};
	const index = highlightedIndex(rows, local.highlightId);
	const highlighted = rows[index];
	const density = densityFor(host.width, host.breakpoints);
	const keysEnabled =
		draftEmpty && !host.busy && !host.blocked && host.queued === 0;
	return {
		mode: "ready",
		density,
		title: state.title,
		...withCue(state.cue),
		rows: rows.map((item) => ({
			item,
			highlighted: item === highlighted,
			source: sourcePlacement(item, density),
		})),
		highlighted,
		position: { index, count: rows.length },
		keysEnabled,
		canSend:
			keysEnabled &&
			highlighted.sendable &&
			local.readyAt !== undefined &&
			host.now - local.readyAt >= SUGGESTION_EXPOSURE_MS,
		skipMeans: index === rows.length - 1 && state.canRefresh ? "more" : "skip",
		canRefresh: state.canRefresh,
	};
}
