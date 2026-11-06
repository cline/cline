import { describe, expect, it } from "vitest";
import { hunkHeader, makeUnifiedDiff } from "./diff";

/** Parse the `@@ -a,b +c,d @@` header into its old/new line counts. */
function lineCounts(diff: string): { old: number; new: number } | null {
	const header = diff.split("\n").find((l) => l.startsWith("@@"));
	if (!header) {
		return null;
	}
	const m = header.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/);
	if (!m) {
		throw new Error(`malformed hunk header: ${header}`);
	}
	return { old: Number(m[2]), new: Number(m[4]) };
}

/** Body lines that carry meaning: additions, removals and context. */
function bodyLines(diff: string): string[] {
	return diff
		.split("\n")
		.slice(2)
		.filter((l) => /^[+\- ]/.test(l));
}

describe("makeUnifiedDiff", () => {
	it("reports zero new lines when all content is deleted", () => {
		// "line1\nline2\n" is three lines: two of content and the empty
		// line the trailing newline opens. Deleting the file removes all
		// three, and none of them may be reported as surviving context.
		const diff = makeUnifiedDiff("line1\nline2\n", "", "notes.txt");

		expect(lineCounts(diff)?.new).toBe(0);
		expect(bodyLines(diff)).toEqual(["-line1", "-line2", "-"]);
	});

	it("does not invent a blank addition when creating an empty file", () => {
		const diff = makeUnifiedDiff("", "", "new.txt");

		// No change at all, so there is nothing to report.
		expect(diff).not.toContain("@@");
		expect(bodyLines(diff)).toEqual([]);
	});

	it("still counts the empty line a trailing newline opens", () => {
		// The guard is on truthiness, so "a\n" must keep its second line
		// rather than collapsing to a single line.
		const diff = makeUnifiedDiff("", "a\n", "one.txt");

		expect(lineCounts(diff)?.new).toBe(2);
		expect(bodyLines(diff)).toEqual(["+a", "+"]);
	});

	it("counts a newline-free single line as one line", () => {
		const diff = makeUnifiedDiff("", "a", "one.txt");

		expect(lineCounts(diff)?.new).toBe(1);
		expect(bodyLines(diff)).toEqual(["+a"]);
	});

	it("renders an ordinary edit unchanged", () => {
		const diff = makeUnifiedDiff("a\nb\nc\n", "a\nB\nc\n", "f.txt");

		expect(lineCounts(diff)).toEqual({ old: 4, new: 4 });
		expect(bodyLines(diff)).toEqual([" a", "-b", "+B", " c", " "]);
	});
});

describe("hunkHeader", () => {
	it("counts an empty body as zero lines", () => {
		expect(hunkHeader([])).toBe("@@ -1,0 +1,0 @@");
	});
});
