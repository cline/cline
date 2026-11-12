import { PLUGIN_UI_LIMITS } from "../constants";
import type {
	ComposerSuggestionItem,
	ComposerSuggestionsState,
} from "../contracts";
import { comparePluginUiOrder } from "../envelope";
import { SUGGESTION_EXPOSURE_MS } from "./constants";
import { highlightedIndex, visibleItems } from "./rows";
import type {
	SuggestionCue,
	SuggestionSourcePlacement,
	SuggestionsDensity,
	SuggestionsHostFacts,
	SuggestionsLocal,
	SuggestionsView,
} from "./types";

const REFRESHING_CUE_TEXT = "finding different suggestions…";

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
