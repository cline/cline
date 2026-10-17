import { DAY_MS, HOUR_MS, MINUTE_MS } from "../config";
import type { Facts } from "./source";

const AGE_UNITS: ReadonlyArray<readonly [ms: number, unit: string]> = [
	[DAY_MS, "d"],
	[HOUR_MS, "h"],
	[MINUTE_MS, "m"],
];

export function ageLabel(at: number | undefined, now: number): string {
	if (at === undefined) return "age unknown";
	const elapsed = Math.max(0, now - at);
	for (const [ms, unit] of AGE_UNITS)
		if (elapsed >= ms) return `${Math.floor(elapsed / ms)}${unit} ago`;
	return "just now";
}

/** One line a connector read in the background, and when. */
export type DatedLine = { fetchedAt: number; line: string };

/** A connector on Mention: the planner may name it, and learns nothing it holds. */
export function mentionOnlyFacts(
	label: string,
	object: string,
	through: string,
): Facts {
	return {
		heading: `${label} (connected; no data read)`,
		lines: [
			`Suggestions may ask the agent to use ${object}, through ${through}.`,
		],
	};
}

/** A connector's background reads, headed with the age of the oldest; unknown before any read. */
export function datedFacts(
	label: string,
	entries: readonly DatedLine[],
	now: number,
): Facts | "unknown" {
	if (entries.length === 0) return "unknown";
	const oldest = Math.min(...entries.map((entry) => entry.fetchedAt));
	return {
		heading: `${label} (as of ${ageLabel(oldest, now)})`,
		lines: entries.map((entry) => entry.line),
	};
}
