import {
	NEXT_TURN_KINDS,
	NEXT_TURN_LABELS,
	type NextTurnKind,
	type NextTurnSuggestion,
	type TurnFacts,
} from "../types";
import { PROMPT_MAX_CHARS, REASON_MAX_CHARS, SET_SIZE } from "./prompt";

const PROMPT_MIN_CHARS = 8;
const QUOTE_PAIRS: Readonly<Record<string, string>> = {
	'"': '"',
	"'": "'",
	"`": "`",
	"“": "”",
	"‘": "’",
};
const KINDS: ReadonlySet<string> = new Set(NEXT_TURN_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneLine(value: unknown, limit: number): string {
	return typeof value === "string"
		? value.replace(/\s+/g, " ").trim().slice(0, limit).trim()
		: "";
}

/**
 * Each complete `{…}` row of the `suggestions` array, so an answer the output
 * budget cut off mid-row keeps the rows before the cut, and prose around the
 * JSON is ignored.
 */
function rowsIn(text: string): unknown[] {
	const array = /"suggestions"\s*:\s*\[/.exec(text);
	if (!array) return [];
	const rows: unknown[] = [];
	let depth = 0;
	let rowStart = 0;
	let inString = false;
	let escaped = false;
	for (let at = array.index + array[0].length; at < text.length; at += 1) {
		const char = text[at];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
		} else if (char === '"') inString = true;
		else if (char === "{") {
			if (depth === 0) rowStart = at;
			depth += 1;
		} else if (char === "}" && depth > 0) {
			depth -= 1;
			if (depth === 0) {
				try {
					rows.push(JSON.parse(text.slice(rowStart, at + 1)));
				} catch {}
			}
		} else if (char === "]" && depth === 0) break;
	}
	return rows;
}

function suggestionOf(row: unknown): NextTurnSuggestion | null {
	if (!isRecord(row)) return null;
	const kind = typeof row.kind === "string" ? row.kind : "";
	if (!KINDS.has(kind)) return null;
	const prompt = unquoted(oneLine(row.prompt, PROMPT_MAX_CHARS));
	if (prompt.length < PROMPT_MIN_CHARS) return null;
	return {
		kind: kind as NextTurnKind,
		label: NEXT_TURN_LABELS[kind as NextTurnKind],
		prompt,
		reason: oneLine(row.reason, REASON_MAX_CHARS),
	};
}

/** A model sometimes wraps the message in quotes; the person would send them too. */
function unquoted(text: string): string {
	const open = text[0] ?? "";
	const close = QUOTE_PAIRS[open];
	const inner = text.slice(1, -1);
	return close &&
		text.length > 1 &&
		text.endsWith(close) &&
		!inner.includes(open)
		? inner.trim()
		: text;
}

function uniqueByPrompt(
	items: readonly NextTurnSuggestion[],
): NextTurnSuggestion[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.prompt)) return false;
		seen.add(item.prompt);
		return true;
	});
}

/**
 * The model's suggestions, or null when its answer holds no usable row. A
 * partly bad or cut-off answer keeps its good rows; an answer with none is a
 * failure, not an empty set, so the rule set stays up instead of a blank one.
 */
export function parsePlannerOutput(text: string): NextTurnSuggestion[] | null {
	const rows = uniqueByPrompt(
		rowsIn(text).flatMap((row) => suggestionOf(row) ?? []),
	).slice(0, SET_SIZE);
	return rows.length > 0 ? rows : null;
}

/**
 * What of the model's answer may replace the rules. The model writes the
 * suggestions; the code keeps the one rule that must hold whatever it says:
 * after a failed or stopped turn the first row deals with that, the model's
 * own when it wrote one and the rule set's lead otherwise.
 */
export function withFailureLead(
	rows: readonly NextTurnSuggestion[],
	rules: readonly NextTurnSuggestion[],
	facts: TurnFacts,
): NextTurnSuggestion[] {
	const lead = rules[0];
	const owed =
		(facts.status !== "completed" || facts.toolErrored) &&
		(lead?.kind === "fix_failure" || lead?.kind === "continue");
	if (!owed) return [...rows];
	const own = rows.find((row) => row.kind === lead.kind);
	return uniqueByPrompt([own ?? lead, ...rows]).slice(0, SET_SIZE);
}
