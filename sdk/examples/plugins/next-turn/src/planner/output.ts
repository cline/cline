import {
	POOL_SIZE,
	PROMPT_MAX_CHARS,
	PROMPT_MIN_CHARS,
	REF_MAX_CHARS,
	SET_SIZE,
	WHY_MAX_CHARS,
} from "../config";
import { isRecord } from "../values";
import {
	type Suggestion,
	type SuggestionSource,
	suggestion,
	type TurnFacts,
	turnLead,
	uniqueByPrompt,
} from "./candidates";
import type { SuggestionKind } from "./kinds";

/**
 * What of the model's answer may reach the tray. The model writes the
 * suggestions; the code keeps every rule that must hold whatever it says:
 * blocked and failed reports lead, a failed turn's fix comes next, exclusions
 * are honoured, only kinds this environment offers survive, outward kinds are
 * Use-only, the set is at most three, and a bad or missing answer falls back
 * to the rules.
 */

/** The planner's `source` field onto the tray's chips; `plan` reads as the plan bank's chip. */
export const PLANNER_SOURCES: Readonly<Record<string, SuggestionSource>> = {
	status: "status",
	tasks: "tasks",
	plan: "bank",
	repo: "repo",
	connector: "connector",
};

function oneLine(value: unknown, limit: number): string {
	return typeof value === "string"
		? value.replace(/\s+/g, " ").trim().slice(0, limit).trim()
		: "";
}

function jsonObjectIn(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
}

function poolRow(
	row: unknown,
	allowed: ReadonlySet<string>,
): Suggestion | null {
	if (!isRecord(row)) return null;
	const kind = typeof row.kind === "string" ? row.kind : "";
	const prompt = oneLine(row.prompt, PROMPT_MAX_CHARS);
	if (!allowed.has(kind) || prompt.length < PROMPT_MIN_CHARS) return null;
	const source =
		PLANNER_SOURCES[typeof row.source === "string" ? row.source : ""] ??
		"model";
	const ref = source === "model" ? "" : oneLine(row.ref, REF_MAX_CHARS);
	return suggestion(
		kind as SuggestionKind,
		source,
		prompt,
		oneLine(row.why, WHY_MAX_CHARS),
		{ ref },
	);
}

/**
 * The model's pool, or null when its answer is not a usable one. A partly bad
 * answer keeps its good rows; an answer with none is a failure, not an empty
 * set, so the rules answer instead of a blank tray. A kind this environment
 * does not offer is dropped, whatever the model claims.
 */
export function parsePlannerOutput(
	text: string,
	kinds: readonly SuggestionKind[],
): Suggestion[] | null {
	const parsed = jsonObjectIn(text);
	if (!isRecord(parsed) || !Array.isArray(parsed.suggestions)) return null;
	const allowed = new Set<string>(kinds);
	const pool = uniqueByPrompt(
		parsed.suggestions.map((row) => poolRow(row, allowed)),
		undefined,
		POOL_SIZE,
	);
	return pool.length > 0 ? pool : null;
}

type ModelSetArgs = {
	pool: readonly Suggestion[];
	/** The rule pool for the same turn: its blocking rows lead, and it tops up what exclusions left short. */
	rules: readonly Suggestion[];
	turn: TurnFacts;
	excluded: readonly string[];
};

/**
 * The set one serve is owed from a model pool: blocking Status rows, then a
 * fix when the turn or a command failed (the model's first fix_failure row,
 * or else the rules' own lead), then the model's suggestions, then the rules.
 * The fix is forced only into the turn's first set: once the person has
 * skipped or rerolled, they have seen it. De-duplicated by prompt, capped.
 */
export function buildModelSet(args: ModelSetArgs): Suggestion[] {
	const blocking = args.rules.filter((item) => item.source === "status");
	const lead = args.excluded.length === 0 ? turnLead(args.turn) : null;
	const fix =
		lead?.kind === "fix_failure"
			? (args.pool.find((item) => item.kind === "fix_failure") ?? lead)
			: null;
	return uniqueByPrompt(
		[...blocking, fix, ...args.pool, ...args.rules],
		new Set(args.excluded),
		SET_SIZE,
	);
}
