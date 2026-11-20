import type { PluginUiTone } from "../constants";
import type {
	ComposerSuggestionItem,
	PluginUiInvokeOutcome,
	PluginUiInvokeResult,
	PluginUiOrder,
	PluginUiStateEnvelope,
} from "../contracts";

export type SuggestionsEnvelope = PluginUiStateEnvelope<"composer.suggestions">;
export type SuggestionCue = { text: string; tone: PluginUiTone };

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
