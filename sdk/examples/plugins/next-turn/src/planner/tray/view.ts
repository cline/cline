import type {
	ComposerSuggestionItem,
	ComposerSuggestionsHiddenReason,
	ComposerSuggestionsState,
	PLUGIN_UI_LIMITS,
	PluginUiIcon,
	PluginUiTone,
} from "@cline/shared";
import {
	type CueCode,
	type Suggestion,
	type SuggestionSource,
	sendable,
	type TurnFacts,
} from "../candidates";
import type { SuggestionKind } from "../kinds";
import type { OfferedSet, OffReason, TrayPush } from "./tray";

/**
 * Next's tray state as Cline's `composer.suggestions` slot. Next keeps its
 * own vocabulary (kinds, cue codes, sources); hosts only ever see the generic
 * words, tones, icons and plain text this file maps them to.
 *
 * Core normalizes every state it stores, so the projection applies the same
 * text passes and limits itself and reaches hosts exactly as written. The
 * passes are a copy, not an import of `clampPluginUiText`: a plugin imports
 * `@cline/shared` for types only, since a named runtime import of a newer
 * export fails to link on an older host. tray.test.ts holds the copy to
 * the shared function.
 */

const LIMITS = {
	items: 3,
	titleChars: 16,
	cueChars: 80,
	noteChars: 160,
	labelChars: 16,
	promptChars: 2_000,
	detailChars: 240,
	sourceLabelChars: 32,
	urlChars: 2_048,
} as const satisfies Partial<typeof PLUGIN_UI_LIMITS>;

const TITLE = "Next";
const COMMAND = "next";
/** The revision of a state with no set behind it, before Next has published any. */
const NO_REVISION = "none";
const TURN_CUE = "reading the last turn…";
const REROLL_CUE = "finding different suggestions…";
const UNAVAILABLE_NOTE = "Suggestions are unavailable in this chat";
const CONNECTOR_LABEL = "Connector";

const TAB = /\t/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing C0/C1 controls (all but "\n") is the purpose of this pattern
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const BIDI_AND_ZERO_WIDTH =
	/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const LONE_SURROGATE =
	/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const WHITESPACE_RUN = /\s+/g;
const ELLIPSIS = "…";

/**
 * The slot's text pass for one field: tabs become spaces; controls other
 * than "\n", bidi and zero-width characters go; lone surrogates become
 * U+FFFD; whitespace runs collapse (only the ends are trimmed when
 * `multiline`); then the text is clamped by code points with "…".
 */
export function clampSlotText(
	value: string,
	maxChars: number,
	multiline = false,
): string {
	const visible = value
		.replace(TAB, " ")
		.replace(CONTROL_CHARACTERS, "")
		.replace(BIDI_AND_ZERO_WIDTH, "")
		.replace(LONE_SURROGATE, "\uFFFD");
	const text = multiline
		? visible.trim()
		: visible.replace(WHITESPACE_RUN, " ").trim();
	const codePoints = Array.from(text);
	if (codePoints.length <= maxChars) return text;
	return `${codePoints
		.slice(0, Math.max(0, maxChars - 1))
		.join("")
		.trimEnd()}${ELLIPSIS}`;
}

type KindView = { label: string; tone: PluginUiTone; icon: PluginUiIcon };

const KIND_VIEWS: Record<SuggestionKind, KindView> = {
	fix_failure: { label: "Fix", tone: "repair", icon: "fix" },
	continue: { label: "Resume", tone: "continue", icon: "resume" },
	next_step: { label: "Next step", tone: "continue", icon: "next" },
	verify: { label: "Verify", tone: "check", icon: "verify" },
	review_diff: { label: "Review", tone: "look", icon: "review" },
	wrap_up: { label: "Wrap up", tone: "finish", icon: "wrap_up" },
	commit: { label: "Commit", tone: "finish", icon: "commit" },
	check_ci: { label: "Check CI", tone: "check", icon: "ci" },
	reply_review: { label: "Reply", tone: "decide", icon: "reply" },
	update_issue: { label: "Update issue", tone: "finish", icon: "issue" },
	post_update: { label: "Post update", tone: "finish", icon: "announce" },
};

function kindView(candidate: Suggestion, cueCode: CueCode): KindView {
	if (candidate.kind === "fix_failure" && cueCode === "failed")
		return { label: "Retry", tone: "repair", icon: "retry" };
	if (candidate.kind === "next_step" && candidate.source === "replenish")
		return { label: "Plan", tone: "continue", icon: "plan" };
	return KIND_VIEWS[candidate.kind];
}

/** Sources a host names as a plain label; `replenish` and `model` rows carry none. */
const SOURCE_LABELS: Partial<Record<SuggestionSource, string>> = {
	turn: "This turn",
	status: "Status Hub",
	tasks: "Tasks",
	bank: "Plan",
	repo: "Repo",
};

const CONNECTOR_SERVICES: readonly (readonly [RegExp, string])[] = [
	[/(^|\.)github\.com$/, "GitHub"],
	[/(^|\.)linear\.app$/, "Linear"],
	[/(^|\.)atlassian\.net$|(^|\.)jira\./, "Jira"],
	[/(^|\.)slack\.com$/, "Slack"],
];

/** A link a host may open: http(s), no credentials, within the slot's length. */
function linkOf(raw: string | undefined): URL | undefined {
	if (!raw) return undefined;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	if (url.username || url.password || url.href.length > LIMITS.urlChars)
		return undefined;
	return url;
}

function connectorLabel(link: URL | undefined): string {
	if (!link) return CONNECTOR_LABEL;
	return (
		CONNECTOR_SERVICES.find(([pattern]) => pattern.test(link.hostname))?.[1] ??
		link.hostname
	);
}

function sourceOf(candidate: Suggestion): ComposerSuggestionItem["source"] {
	const link = linkOf(candidate.url);
	const name =
		candidate.source === "connector"
			? connectorLabel(link)
			: SOURCE_LABELS[candidate.source];
	if (!name) return undefined;
	const label = clampSlotText(name, LIMITS.sourceLabelChars);
	return link ? { label, url: link.href } : { label };
}

function filesChanged(count: number | undefined): string {
	if (count === 1) return "after 1 file changed";
	return count ? `after ${count} files changed` : "after files changed";
}

function cueOf(
	cueCode: CueCode,
	facts: TurnFacts | undefined,
): { text: string; tone: PluginUiTone } {
	switch (cueCode) {
		case "tool_error":
			return { text: "after a command failed", tone: "repair" };
		case "failed":
			return { text: "after the turn failed", tone: "repair" };
		case "completed_edits":
			return { text: filesChanged(facts?.filesEdited), tone: "check" };
		case "completed_no_edits":
			return { text: "after the last turn", tone: "neutral" };
		case "cancelled":
			return { text: "after you stopped the turn", tone: "neutral" };
	}
}

/** Why the set answers from the rules: one plain line, never the planner's own error. */
function noteOf(set: OfferedSet): string | undefined {
	switch (set.model?.status) {
		case "no_provider":
			return "Using rules: no planner model is set";
		case "error":
			return "Using rules: the planner is unavailable";
		case "paused":
			return "Using rules for now";
		default:
			return set.paused ? "Using rules for now" : undefined;
	}
}

function itemsOf(set: OfferedSet): ComposerSuggestionItem[] {
	const items: ComposerSuggestionItem[] = [];
	const seen = new Set<string>();
	for (const candidate of set.candidates) {
		const view = kindView(candidate, set.cueCode);
		const label = clampSlotText(view.label, LIMITS.labelChars);
		const prompt = clampSlotText(candidate.prompt, LIMITS.promptChars, true);
		// A host trims a prompt and runs one that starts with "/" as its own command.
		if (!label || !prompt || prompt.startsWith("/") || seen.has(candidate.id))
			continue;
		seen.add(candidate.id);
		const detail = clampSlotText(candidate.why, LIMITS.detailChars);
		const source = sourceOf(candidate);
		items.push({
			id: candidate.id,
			label,
			tone: view.tone,
			icon: view.icon,
			prompt,
			...(detail ? { detail } : {}),
			...(source ? { source } : {}),
			sendable: sendable(candidate),
		});
		if (items.length === LIMITS.items) break;
	}
	return items;
}

const HIDDEN_REASONS: Record<OffReason, ComposerSuggestionsHiddenReason> = {
	message: "superseded",
	hidden: "user",
	disabled: "disabled",
};

export type SuggestionsProjection = {
	/** The chat's latest turn, for the cue that counts changed files. */
	facts?: TurnFacts;
	/** The newest offer published so far: the revision of a state with no set of its own. */
	lastRevision?: string;
};

function emptyState(revision: string) {
	return {
		title: TITLE,
		command: COMMAND,
		revision,
		items: [],
		canRefresh: false,
	};
}

/**
 * A chat no viewer attached to yet: hidden with no reason, so it neither
 * ends a sent line nor says Next is off. Published at setup, it is the new
 * copy's first state, which tells a renderer still bound to the chat that
 * it restarted, so the renderer attaches again (the epoch re-attach rule).
 */
export function dormantState(): ComposerSuggestionsState {
	return { ...emptyState(NO_REVISION), status: "hidden" };
}

/** One tray push as the `composer.suggestions` state, already in the form core stores. */
export function toSuggestionsState(
	push: TrayPush,
	{ facts, lastRevision }: SuggestionsProjection = {},
): ComposerSuggestionsState {
	const empty = emptyState(push.set?.offerId ?? lastRevision ?? NO_REVISION);
	switch (push.state) {
		case "computing":
			return {
				...empty,
				status: "loading",
				cue: {
					text: clampSlotText(
						push.computingFor === "reroll" ? REROLL_CUE : TURN_CUE,
						LIMITS.cueChars,
					),
					tone: "neutral",
				},
			};
		case "unavailable":
			return {
				...empty,
				status: "unavailable",
				note: clampSlotText(UNAVAILABLE_NOTE, LIMITS.noteChars),
			};
		case "off":
			return {
				...empty,
				status: "hidden",
				hiddenReason: HIDDEN_REASONS[push.offReason ?? "disabled"],
			};
	}
	const set = push.set;
	const items = set ? itemsOf(set) : [];
	const status =
		push.state === "ready" && items.length === 0 ? "empty" : push.state;
	if (!set) return { ...empty, status };
	const cue = cueOf(set.cueCode, facts);
	const note = noteOf(set);
	return {
		...empty,
		status,
		cue: { text: clampSlotText(cue.text, LIMITS.cueChars), tone: cue.tone },
		...(note ? { note: clampSlotText(note, LIMITS.noteChars) } : {}),
		items,
		canRefresh: (push.rerollsLeft ?? set.rerollsLeft ?? 0) > 0,
	};
}
