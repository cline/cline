import type { GuidanceDiff } from "../../../../chat/messages/factory-guidance-approval";

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

const lines = (text: string) =>
	text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

/**
 * The lines of `after` against `before`, by longest common subsequence.
 * Guidance is at most 8,000 characters, so the table stays small.
 */
export function diffLines(before: string, after: string): DiffLine[] {
	const a = lines(before);
	const b = lines(after);
	const table: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			table[i][j] =
				a[i] === b[j]
					? table[i + 1][j + 1] + 1
					: Math.max(table[i + 1][j], table[i][j + 1]);
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({ kind: "same", text: a[i] });
			i++;
			j++;
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			out.push({ kind: "removed", text: a[i++] });
		} else {
			out.push({ kind: "added", text: b[j++] });
		}
	}
	while (i < a.length) out.push({ kind: "removed", text: a[i++] });
	while (j < b.length) out.push({ kind: "added", text: b[j++] });
	return out;
}

/** The whole change as one hunk, for `FactoryGuidanceDiffView`. */
export function guidanceDiff(before: string, after: string): GuidanceDiff {
	const changes = diffLines(before, after);
	return {
		hunks: [{ oldStart: 1, newStart: 1, oldText: before, newText: after }],
		additions: changes.filter((line) => line.kind === "added").length,
		removals: changes.filter((line) => line.kind === "removed").length,
	};
}
