import { buildToolSummary } from "@cline/ui/components/agent-chat/tool-summary";
import { describe, expect, it } from "vitest";
import { parseToolDiff } from "./diff";
import { diffCounts, toolLabel } from "./tools";

const PATCH = `*** Begin Patch
*** Update File: apps/mobile/src/App.tsx
@@
-const oldValue = true;
+const newValue = true;
*** Add File: apps/mobile/src/new.ts
+export const ready = true;
*** End Patch`;

describe("mobile tool presentation", () => {
	it.each([
		["run_commands", { commands: ["bun test", "bun run typecheck"] }],
		["bash", { command: "git status" }],
		[
			"read_files",
			{ files: [{ path: "src/App.tsx", start_line: 2, end_line: 8 }] },
		],
		["editor", { path: "src/App.tsx", old_text: "before", new_text: "after" }],
		["apply_patch", { input: PATCH }],
		["search_codebase", { query: "TODO" }],
		["fetch_web_content", { url: "https://example.com" }],
		["mcp_example", { query: "hello" }],
	] as const)("uses desktop's shared labels for %s", (name, input) => {
		for (const state of ["running", "completed"] as const) {
			expect(toolLabel(name, state, input)).toBe(
				buildToolSummary({
					toolName: name,
					input,
					inProgress: state === "running",
				}).label,
			);
		}
	});

	it("keeps rename and hunk boundaries in apply_patch previews", () => {
		const [file] = parseToolDiff(
			"apply_patch",
			{
				patch:
					"*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n@@ first\n-a\n+b\n@@ second\n-c\n+d\n*** End Patch",
			},
			undefined,
		);
		expect(file?.path).toBe("new.ts");
		expect(file?.lines.filter((line) => line.kind === "header")).toHaveLength(
			3,
		);
		expect(file).toMatchObject({ additions: 2, deletions: 2 });
	});

	it("accepts archived JSON inputs and legacy editor field aliases", () => {
		for (const input of [
			{ file_path: "a.ts", old_str: "before", new_str: "after\n" },
			JSON.stringify({ path: "a.ts", old_text: "before", new_text: "after\n" }),
		]) {
			expect(parseToolDiff("edit_file", input, undefined)[0]).toMatchObject({
				path: "a.ts",
				additions: 1,
				deletions: 1,
			});
		}
	});

	it("keeps every line of large editor inputs with linear projection", () => {
		const input = {
			path: "large.ts",
			old_text: "old\n".repeat(5000),
			new_text: "new\n".repeat(5000),
		};
		expect(toolLabel("editor", "running", input)).toBe("Editing file large.ts");
		const files = parseToolDiff("editor", input, undefined);
		expect(files[0]).toMatchObject({ additions: 5000, deletions: 5000 });
		expect(files[0]?.lines).toHaveLength(10000);
	});

	it.each([
		undefined,
		null,
		{},
		"{bad json",
		42,
	])("handles malformed input without throwing: %s", (input) => {
		expect(() => toolLabel("editor", "completed", input)).not.toThrow();
		expect(parseToolDiff("editor", input, undefined)).toEqual([]);
	});
	it("parses apply_patch into per-file colored-line data", () => {
		const files = parseToolDiff("apply_patch", { input: PATCH }, undefined);
		expect(files).toHaveLength(2);
		expect(files[0]).toMatchObject({
			path: "apps/mobile/src/App.tsx",
			additions: 1,
			deletions: 1,
		});
		expect(files[1]).toMatchObject({ additions: 1, deletions: 0 });
	});

	it("parses standard unified diffs without counting file headers", () => {
		const files = parseToolDiff(
			"editor",
			{ diff: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new" },
			undefined,
		);
		expect(files).toEqual([
			expect.objectContaining({ path: "a.ts", additions: 1, deletions: 1 }),
		]);
	});

	it("does not count a terminal newline as an added blank line", () => {
		const [file] = parseToolDiff(
			"editor",
			{ path: "a.ts", old_text: "", new_text: "line\n" },
			undefined,
		);
		expect(file).toMatchObject({ additions: 1, deletions: 0 });
		expect(file?.lines).toEqual([{ kind: "addition", text: "line" }]);
	});

	it("never awards diff chips to command output that happens to contain a diff", () => {
		expect(diffCounts("bash", { command: "git diff" }, PATCH)).toBeUndefined();
		expect(diffCounts("apply_patch", { input: PATCH }, undefined)).toEqual({
			additions: 2,
			deletions: 1,
		});
	});

	it("uses the same command verbs as Cline", () => {
		expect(toolLabel("run_commands", "running", { command: "bun test" })).toBe(
			"Running command bun test",
		);
		expect(
			toolLabel("run_commands", "completed", { command: "bun test" }),
		).toBe("Ran command bun test");
		expect(toolLabel("run_commands", "failed", { command: "bun test" })).toBe(
			"Failed: Ran command bun test",
		);
	});
});
