import { PROMPT_MAX_CHARS, REF_MAX_CHARS, WHY_MAX_CHARS } from "../config";
import { isOutward, type SuggestionKind } from "./kinds";

/**
 * The vocabulary of a suggestion: one vocabulary for every host. Ids, kinds,
 * prompts and whys are kept word for word across hosts, so labels from any
 * host name the same row; `test-fixtures/host-rules.json` holds the plugin to
 * the rows the hosts produce today.
 */

/**
 * Where the fact behind a row comes from, which names its chip: the turn, the
 * Status Hub, the agenda, a host's plan bank (`bank`, the tray's existing chip),
 * the working tree, a connector, the planning prompt, or the model's own.
 */
export const SUGGESTION_SOURCES = [
	"turn",
	"status",
	"tasks",
	"bank",
	"repo",
	"connector",
	"replenish",
	"model",
] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export type Suggestion = {
	id: string;
	kind: SuggestionKind;
	source: SuggestionSource;
	prompt: string;
	why: string;
	/** What the source names, for the tray's source link: a Status subject, a task id, a plan step. */
	ref?: string;
	/** A connector fact's link, such as the pull request. */
	url?: string;
	/** Posts, pushes or comments outside the machine: the tray offers Use only, never Send. */
	outward?: true;
};

export type TurnStatus = "completed" | "cancelled" | "failed";

/** What the turn did, from the run result alone. */
export type TurnFacts = {
	status: TurnStatus;
	filesEdited: number;
	toolErrored: boolean;
};

export const CUE_CODES = [
	"cancelled",
	"failed",
	"tool_error",
	"completed_edits",
	"completed_no_edits",
] as const;
export type CueCode = (typeof CUE_CODES)[number];

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * FNV-1a 32-bit as eight hex chars: short, stable, token-safe ids. Both hosts
 * id candidates with this hash, so labels from either name the same row.
 */
export function fnv1a32(text: string): string {
	let hash = FNV_OFFSET_BASIS;
	for (let index = 0; index < text.length; index += 1) {
		hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME_32) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function suggestionId(kind: SuggestionKind, prompt: string): string {
	return fnv1a32(`${kind}:${prompt}`);
}

/** Text within `max` stays byte for byte, so the hosts' rows keep their ids. */
function clip(text: string, max: number): string {
	return text.length <= max ? text : text.slice(0, max).trimEnd();
}

/** A row inside the published bounds, whatever a task title, headline or check name made it say. */
export function suggestion(
	kind: SuggestionKind,
	source: SuggestionSource,
	prompt: string,
	why: string,
	extra: { ref?: string; url?: string } = {},
): Suggestion {
	const boundedPrompt = clip(prompt, PROMPT_MAX_CHARS);
	const ref = extra.ref?.trim().slice(0, REF_MAX_CHARS);
	return {
		id: suggestionId(kind, boundedPrompt),
		kind,
		source,
		prompt: boundedPrompt,
		why: clip(why, WHY_MAX_CHARS),
		...(ref ? { ref } : {}),
		...(extra.url ? { url: extra.url } : {}),
		...(isOutward(kind) ? { outward: true as const } : {}),
	};
}

export function uniqueByPrompt(
	items: Iterable<Suggestion | null | undefined>,
	skip: ReadonlySet<string> = new Set(),
	limit = Number.POSITIVE_INFINITY,
): Suggestion[] {
	const seen = new Set(skip);
	const out: Suggestion[] = [];
	for (const item of items) {
		if (!item || seen.has(item.prompt)) continue;
		seen.add(item.prompt);
		out.push(item);
		if (out.length >= limit) break;
	}
	return out;
}

/** The header cue, keyed only on the turn's facts so it cannot hallucinate; first match wins. */
export function cueCode(turn: TurnFacts): CueCode {
	if (turn.status === "cancelled") return "cancelled";
	if (turn.status === "failed") return "failed";
	if (turn.toolErrored) return "tool_error";
	if (turn.filesEdited > 0) return "completed_edits";
	return "completed_no_edits";
}

export const PLAN_PROMPT = "Plan the next few tasks for this work.";
const PLAN_WHY =
	"Nothing is tracked for this chat yet, so the next step is to plan some.";
export const REVIEW_PROMPT =
	"Review the changes from the last turn before going on.";
export const COMMIT_PROMPT =
	"Commit these changes with a message that says why they were made.";

function filesChanged(count: number, when: string): string {
	return count === 1
		? `1 file changed ${when}.`
		: `${count} files changed ${when}.`;
}

/** The one thing the turn itself most owes the person, before anything tracked. */
export function turnLead(turn: TurnFacts): Suggestion | null {
	switch (cueCode(turn)) {
		case "cancelled":
			return suggestion(
				"continue",
				"turn",
				"Pick up the work the stopped turn left unfinished.",
				"The last turn was stopped before it finished.",
			);
		case "failed":
			return suggestion(
				"fix_failure",
				"turn",
				"Retry the last turn — it ended in an error.",
				"The last turn ended in an error.",
			);
		case "tool_error":
			return suggestion(
				"fix_failure",
				"turn",
				"Fix the failure from the last turn and run it again.",
				"A command in the last turn failed.",
			);
		default:
			return null;
	}
}

/** The closing suggestion the turn's outcome earns, after everything tracked. */
export function turnTail(turn: TurnFacts): Suggestion | null {
	if (turn.status !== "completed") return null;
	if (turn.toolErrored && turn.filesEdited > 0) {
		return suggestion(
			"review_diff",
			"turn",
			REVIEW_PROMPT,
			"A command failed and files changed this turn.",
		);
	}
	if (turn.filesEdited > 0) {
		return suggestion(
			"verify",
			"turn",
			"Run the checks for the files the last turn changed.",
			filesChanged(turn.filesEdited, "this turn"),
		);
	}
	return suggestion(
		"wrap_up",
		"turn",
		"Summarize what the last turn did and what is left to do.",
		"The last turn completed without changing files.",
	);
}

/** A review of a clean turn's edits: the CLI's third row. */
export function cleanEditReview(turn: TurnFacts): Suggestion | null {
	if (turn.status !== "completed" || turn.toolErrored || turn.filesEdited === 0)
		return null;
	return suggestion(
		"review_diff",
		"turn",
		REVIEW_PROMPT,
		filesChanged(turn.filesEdited, "this turn"),
	);
}

/** A commit of a dirty tree after a clean turn: the CLI's fourth row. */
export function commitRow(
	turn: TurnFacts,
	dirtyFiles: number | undefined,
): Suggestion | null {
	if (
		turn.status !== "completed" ||
		turn.toolErrored ||
		!dirtyFiles ||
		dirtyFiles <= 0
	)
		return null;
	return suggestion(
		"commit",
		"repo",
		COMMIT_PROMPT,
		dirtyFiles === 1
			? "1 file has uncommitted changes."
			: `${dirtyFiles} files have uncommitted changes.`,
	);
}

export function planRow(): Suggestion {
	return suggestion("next_step", "replenish", PLAN_PROMPT, PLAN_WHY);
}
