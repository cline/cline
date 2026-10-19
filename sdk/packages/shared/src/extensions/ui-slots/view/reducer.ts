import type { ComposerSuggestionsState } from "../contracts";
import { applyPluginUiState } from "../envelope";
import {
	SUGGESTION_PENDING_UNDO_MS,
	SUGGESTION_STALE_NOTE_MS,
} from "./constants";
import { highlightedIndex, visibleItems } from "./rows";
import type {
	SuggestionRef,
	SuggestionsEnvelope,
	SuggestionsLocal,
	SuggestionsLocalEvent,
} from "./types";

const EXPOSED_REVISIONS_KEPT = 32;

export function createSuggestionsLocal(): SuggestionsLocal {
	return {
		attachUnconfirmed: false,
		attachDue: false,
		pendingSkipIds: [],
		refreshing: false,
		exposedRevisions: new Set(),
	};
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
		case "sent":
			// A one-key Send needs an empty box, so a `used` here was picked
			// during its verdict wait and is still in the box.
			if (event.ref) return { ...local, sent: event.ref };
			return local.used
				? { ...local, sent: local.used, used: undefined }
				: local;
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
