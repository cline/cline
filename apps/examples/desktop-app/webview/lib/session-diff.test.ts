import { describe, expect, it } from "vitest";
import {
	mergeToolDiffs,
	parseApplyPatchInput,
	type SessionHookEvent,
} from "./session-diff";

describe("parseApplyPatchInput", () => {
	it("parses an update without fabricating line numbers", () => {
		const patch = [
			"*** Begin Patch",
			"*** Update File: /tmp/demo/notes.txt",
			"@@",
			" item 39: placeholder text for line 39",
			"-item 40: placeholder text for line 40",
			"+item 40: UPDATED BY AGENT",
			" item 41: placeholder text for line 41",
			"*** End Patch",
		].join("\n");

		const diffs = parseApplyPatchInput(patch);

		expect(diffs).toHaveLength(1);
		expect(diffs[0]).toMatchObject({
			path: "/tmp/demo/notes.txt",
			additions: 1,
			deletions: 1,
		});
		expect(diffs[0]?.hunks).toEqual([
			{
				old: "item 40: placeholder text for line 40",
				new: "item 40: UPDATED BY AGENT",
			},
		]);
		// The patch format carries no line numbers, so none may be invented.
		expect(diffs[0]?.hunks[0]?.oldStart).toBeUndefined();
		expect(diffs[0]?.hunks[0]?.newStart).toBeUndefined();
	});

	it("splits change runs on context lines even without a leading space", () => {
		const patch = [
			"*** Begin Patch",
			"*** Update File: src/app.ts",
			"@@",
			"-const a = 1;",
			"+const a = 2;",
			"unprefixed context line",
			"-const b = 3;",
			"+const b = 4;",
			"*** End Patch",
		].join("\n");

		const diffs = parseApplyPatchInput(patch);

		expect(diffs[0]?.additions).toBe(2);
		expect(diffs[0]?.deletions).toBe(2);
		expect(diffs[0]?.hunks).toEqual([
			{ old: "const a = 1;", new: "const a = 2;" },
			{ old: "const b = 3;", new: "const b = 4;" },
		]);
	});

	it("numbers added files from line 1", () => {
		const patch = [
			"*** Begin Patch",
			"*** Add File: docs/new.md",
			"+# Title",
			"+body",
			"*** End Patch",
		].join("\n");

		const diffs = parseApplyPatchInput(patch);

		expect(diffs[0]).toMatchObject({
			path: "docs/new.md",
			additions: 2,
			deletions: 0,
		});
		expect(diffs[0]?.hunks).toEqual([
			{ newStart: 1, old: "", new: "# Title\nbody" },
		]);
	});
});

describe("mergeToolDiffs (editor tool)", () => {
	function editorEvent(
		input: Record<string, unknown>,
		result: string,
	): SessionHookEvent {
		return {
			hookEventName: "tool_result",
			toolName: "editor",
			toolInput: input,
			toolOutput: {
				query: `edit:${String(input.path)}`,
				result,
				success: true,
			},
		};
	}

	it("keeps the real line numbers reported by str_replace results", () => {
		const diffs = mergeToolDiffs([
			editorEvent(
				{ path: "src/app.ts", old_text: "old line", new_text: "new line" },
				[
					"Edited src/app.ts",
					"```diff",
					"-467: \told line",
					"-468: \tsecond old",
					"+467: \tnew line",
					"```",
				].join("\n"),
			),
		]);

		expect(diffs).toHaveLength(1);
		expect(diffs[0]).toMatchObject({ additions: 1, deletions: 2 });
		expect(diffs[0]?.hunks).toEqual([
			{
				oldStart: 467,
				newStart: 467,
				old: "\told line\n\tsecond old",
				new: "\tnew line",
			},
		]);
	});

	it("starts inserted text at the insert_line boundary", () => {
		const diffs = mergeToolDiffs([
			editorEvent(
				{ path: "src/app.ts", insert_line: 40, new_text: "inserted" },
				"Inserted content at line 40 in src/app.ts.",
			),
		]);

		expect(diffs[0]?.hunks).toEqual([
			{ newStart: 40, old: "", new: "inserted" },
		]);
	});

	it("counts every created line, including blank ones", () => {
		const diffs = mergeToolDiffs([
			editorEvent(
				{ path: "docs/new.md", new_text: "# Title\n\nbody\n" },
				"File created successfully at: docs/new.md",
			),
		]);

		expect(diffs[0]).toMatchObject({ additions: 3, deletions: 0 });
		expect(diffs[0]?.hunks).toEqual([
			{ newStart: 1, old: "", new: "# Title\n\nbody" },
		]);
	});

	it("accumulates additions and deletions per file across events", () => {
		const diffs = mergeToolDiffs([
			editorEvent(
				{ path: "src/app.ts", old_text: "a", new_text: "b" },
				"Edited src/app.ts\n```diff\n-10: a\n+10: b\n```",
			),
			editorEvent(
				{ path: "src/app.ts", old_text: "c", new_text: "d" },
				"Edited src/app.ts\n```diff\n-20: c\n+20: d\n```",
			),
		]);

		expect(diffs).toHaveLength(1);
		expect(diffs[0]).toMatchObject({ additions: 2, deletions: 2 });
		expect(diffs[0]?.hunks.map((hunk) => hunk.oldStart)).toEqual([10, 20]);
	});
});
