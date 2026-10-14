import {
	POOL_SIZE,
	PROMPT_MAX_CHARS,
	PROMPT_MIN_CHARS,
	REF_MAX_CHARS,
	SET_SIZE,
	WHY_MAX_CHARS,
} from "../config";
import {
	cueCode,
	FAILURE_CUES,
	type Suggestion,
	type SuggestionKind,
	type SuggestionSource,
	suggestion,
	type TurnFacts,
	turnLead,
} from "./candidates";
import { isOutward } from "./kinds";

/**
 * What of the model's answer may reach the tray (
 * `next-action-planner.ts`, moved). The model writes the suggestions; the code
 * keeps every rule that must hold whatever it says: blocked and failed reports
 * lead, a failed turn's fix comes next, exclusions are honoured, only kinds
 * this environment offers survive, outward kinds are Use-only, the set is at
 * most three, and a bad or missing answer falls back to the rules.
 */

/** The planner's `source` field onto the tray's chips; `plan` reads as the plan bank's chip. */
const PLANNER_SOURCES: Readonly<Record<string, SuggestionSource>> = {
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
	if (typeof parsed !== "object" || parsed === null) return null;
	const rows = (parsed as { suggestions?: unknown }).suggestions;
	if (!Array.isArray(rows)) return null;
	const allowed = new Set<string>(kinds);
	const seen = new Set<string>();
	const pool: Suggestion[] = [];
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const record = row as Record<string, unknown>;
		const kind = typeof record.kind === "string" ? record.kind : "";
		const prompt = oneLine(record.prompt, PROMPT_MAX_CHARS);
		if (
			!allowed.has(kind) ||
			prompt.length < PROMPT_MIN_CHARS ||
			seen.has(prompt)
		)
			continue;
		seen.add(prompt);
		const source =
			PLANNER_SOURCES[typeof record.source === "string" ? record.source : ""] ??
			"model";
		const ref = source === "model" ? "" : oneLine(record.ref, REF_MAX_CHARS);
		const typed = kind as SuggestionKind;
		pool.push(
			suggestion(typed, source, prompt, oneLine(record.why, WHY_MAX_CHARS), {
				ref,
				outward: isOutward(typed),
			}),
		);
		if (pool.length === POOL_SIZE) break;
	}
	return pool.length > 0 ? pool : null;
}

export type ModelSetArgs = {
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
	const excluded = new Set(args.excluded);
	const blocking = args.rules.filter((item) => item.source === "status");
	const failing =
		args.excluded.length === 0 && FAILURE_CUES.has(cueCode(args.turn));
	const fix = failing
		? (args.pool.find(
				(item) => item.kind === "fix_failure" && !excluded.has(item.prompt),
			) ?? turnLead(args.turn))
		: null;
	const seen = new Set<string>();
	const out: Suggestion[] = [];
	for (const item of [
		...blocking,
		...(fix ? [fix] : []),
		...args.pool,
		...args.rules,
	]) {
		if (excluded.has(item.prompt) || seen.has(item.prompt)) continue;
		seen.add(item.prompt);
		out.push(item);
		if (out.length === SET_SIZE) break;
	}
	return out;
}
