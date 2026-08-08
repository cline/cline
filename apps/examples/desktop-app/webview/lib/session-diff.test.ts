import { describe, expect, it } from "vitest";
import {
	buildSessionDiffState,
	mergeToolDiffs,
	type SessionHookEvent,
} from "./session-diff";

function editorCreateEvent(path: string, newText: string): SessionHookEvent {
	return {
		hookName: "tool_result",
		toolName: "editor",
		toolInput: { path, new_text: newText },
		toolOutput: { success: true, result: `File created: ${path}` },
	};
}

function editorReplaceEvent(path: string, diffBody: string): SessionHookEvent {
	return {
		hookName: "tool_result",
		toolName: "editor",
		toolInput: { path, old_text: "before", new_text: "after" },
		toolOutput: {
			success: true,
			result: `Edited ${path}\n\`\`\`diff\n${diffBody}\n\`\`\``,
		},
	};
}

describe("mergeToolDiffs path canonicalization", () => {
	it("merges relative and absolute spellings of the same file into one entry", () => {
		// Regression: a file created with a relative path and later edited via
		// its absolute path was listed twice, splitting the counts and showing
		// stale content as a separate entry.
		const events = [
			editorCreateEvent("journal.txt", "line one\nline two"),
			editorReplaceEvent("/tmp/qa-ws/journal.txt", "+3: line three"),
		];

		const merged = mergeToolDiffs(events, "/tmp/qa-ws");

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			path: "journal.txt",
			additions: 3,
			deletions: 0,
		});
		expect(merged[0]?.hunks).toHaveLength(2);
	});

	it("keeps files outside the cwd on their resolved path", () => {
		const merged = mergeToolDiffs(
			[editorCreateEvent("/etc/other/config.txt", "x")],
			"/tmp/qa-ws",
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.path).toBe("/etc/other/config.txt");
	});

	it("keeps distinct files separate", () => {
		const merged = mergeToolDiffs(
			[
				editorCreateEvent("a.txt", "one"),
				editorCreateEvent("/tmp/qa-ws/b.txt", "two"),
			],
			"/tmp/qa-ws",
		);
		expect(merged.map((entry) => entry.path).sort()).toEqual([
			"a.txt",
			"b.txt",
		]);
	});

	it("falls back to raw path keys without a cwd", () => {
		const merged = mergeToolDiffs([
			editorCreateEvent("journal.txt", "one"),
			editorCreateEvent("/tmp/qa-ws/journal.txt", "two"),
		]);
		// Without a cwd there is no way to know these are the same file.
		expect(merged).toHaveLength(2);
	});

	it("sums the summary across canonicalized entries", () => {
		const state = buildSessionDiffState(
			[
				editorCreateEvent("journal.txt", "line one\nline two"),
				editorReplaceEvent("/tmp/qa-ws/journal.txt", "+3: line three"),
			],
			"/tmp/qa-ws",
		);
		expect(state.summary).toEqual({ additions: 3, deletions: 0 });
	});
});
