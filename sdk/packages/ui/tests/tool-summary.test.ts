import { describe, expect, it } from "vitest";
import {
	buildGroupedToolLabel,
	buildReadFilesKeys,
	buildToolSummary,
	classifyTool,
	extractOutputText,
	normalizeToolName,
	parseApplyPatchInput,
	parseReadFilesInput,
	shortenPath,
} from "../components/agent-chat/tool-summary";

describe("normalizeToolName / classifyTool", () => {
	it("applies aliases from other runtimes", () => {
		expect(normalizeToolName("bash")).toBe("run_commands");
		expect(normalizeToolName("Edit_File")).toBe("editor");
		expect(normalizeToolName("web-fetch")).toBe("fetch_web_content");
	});

	it("classifies sdk tool names", () => {
		expect(classifyTool("read_files")).toBe("read");
		expect(classifyTool("editor")).toBe("edit");
		expect(classifyTool("apply_patch")).toBe("edit");
		expect(classifyTool("run_commands")).toBe("command");
		expect(classifyTool("search_codebase")).toBe("search");
		expect(classifyTool("fetch_web_content")).toBe("web");
		expect(classifyTool("spawn_agent")).toBe("spawn");
		expect(classifyTool("subagent_review")).toBe("spawn");
		expect(classifyTool("team_status")).toBe("team");
		expect(classifyTool("skills")).toBe("skill");
		expect(classifyTool("ask_question")).toBe("question");
		expect(classifyTool("mcp_linear_create_issue")).toBe("mcp");
	});

	it("falls back to fuzzy classification for unknown names", () => {
		expect(classifyTool("terminal_run")).toBe("command");
		expect(classifyTool("grep_repo")).toBe("search");
		expect(classifyTool("browser_navigate")).toBe("web");
		expect(classifyTool("some_custom_tool")).toBe("other");
	});
});

describe("read_files summaries", () => {
	it("labels a single file with its line range inline", () => {
		const summary = buildToolSummary({
			toolName: "read_files",
			input: { files: [{ path: "src/app.tsx", start_line: 10, end_line: 80 }] },
		});
		expect(summary.label).toBe("Read file app.tsx (10–80)");
		expect(summary.labelParts).toEqual([
			{ text: "Read file " },
			{ text: "app.tsx (10–80)", code: true },
		]);
		expect(summary.kind).toBe("read");
		expect(summary.details).toEqual(["src/app.tsx:10-80"]);
		expect(summary.items).toEqual([
			{
				type: "file",
				path: "src/app.tsx",
				displayPath: "src/app.tsx",
				startLine: 10,
				endLine: 80,
				language: "tsx",
			},
		]);
	});

	it("marks open-ended reads with a + suffix", () => {
		const summary = buildToolSummary({
			toolName: "read_files",
			input: { files: [{ path: "a.ts", start_line: 100 }] },
		});
		expect(summary.label).toBe("Read file a.ts (100+)");
		expect(summary.details).toEqual(["a.ts:100+"]);
	});

	it("aggregates multiple files with per-file detail lines", () => {
		const summary = buildToolSummary({
			toolName: "read_files",
			input: { file_paths: ["src/a.ts", "src/b.ts", "src/c.ts"] },
			inProgress: true,
		});
		expect(summary.label).toBe("Reading 3 files");
		expect(summary.details).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
		expect(summary.aggregate?.count).toBe(3);
	});

	it("accepts the paths / bare string / JSON-string shapes", () => {
		expect(
			buildToolSummary({ toolName: "read_files", input: { paths: ["x.go"] } })
				.label,
		).toBe("Read file x.go");
		expect(
			buildToolSummary({
				toolName: "read_files",
				input: '{"file_paths":["y.rs"]}',
			}).label,
		).toBe("Read file y.rs");
	});

	it("shortens long paths in details but keeps basenames in labels", () => {
		const longPath =
			"apps/examples/desktop-app/webview/components/views/chat/chat-messages.tsx";
		const summary = buildToolSummary({
			toolName: "read_files",
			input: { file_paths: [longPath] },
		});
		expect(summary.label).toBe("Read file chat-messages.tsx");
		expect(summary.details[0]).toBe(shortenPath(longPath));
		expect(summary.details[0].startsWith(".../")).toBe(true);
	});
});

describe("run_commands summaries", () => {
	it("leads a single command with the action, command in mono", () => {
		const summary = buildToolSummary({
			toolName: "run_commands",
			input: { commands: ["bun run test"] },
		});
		expect(summary.label).toBe("Ran command bun run test");
		expect(summary.labelParts).toEqual([
			{ text: "Ran command " },
			{ text: "bun run test", code: true },
		]);
		expect(summary.items).toEqual([
			{ type: "command", command: "bun run test" },
		]);
		// The layer above may ellipsize the label, so the expanded panel
		// always carries the full command.
		expect(summary.details).toEqual(["bun run test"]);
	});

	it("never truncates labels by default — layout owns overflow", () => {
		const command = `echo ${"x".repeat(400)}`;
		const summary = buildToolSummary({
			toolName: "run_commands",
			input: { commands: [command] },
		});
		expect(summary.label).toBe(`Ran command ${command}`);
	});

	it("applies maxInlineChars only when a consumer opts in", () => {
		const summary = buildToolSummary(
			{
				toolName: "run_commands",
				input: { commands: [`echo ${"x".repeat(400)}`] },
			},
			{ maxInlineChars: 60 },
		);
		expect(summary.label.length).toBeLessThanOrEqual(
			"Ran command ".length + 60,
		);
		expect(summary.label.endsWith("…")).toBe(true);
		expect(summary.details[0]).toBe(`echo ${"x".repeat(400)}`);
	});

	it("accepts every run_commands union shape", () => {
		const cases: Array<[unknown, string[]]> = [
			[{ commands: "ls -la" }, ["ls -la"]],
			[{ commands: { command: "git", args: ["status"] } }, ["git status"]],
			[[{ command: "bun", args: ["test"] }], ["bun test"]],
			[{ command: "bun", args: ["run", "lint"] }, ["bun run lint"]],
			[{ cmd: "pwd" }, ["pwd"]],
			[
				["ls", "pwd"],
				["ls", "pwd"],
			],
			["whoami", ["whoami"]],
		];
		for (const [input, expected] of cases) {
			const summary = buildToolSummary({ toolName: "run_commands", input });
			expect(summary.items).toEqual(
				expected.map((command) => ({ type: "command", command })),
			);
		}
	});

	it("aggregates multiple commands and joins structured entries", () => {
		const summary = buildToolSummary({
			toolName: "run_commands",
			input: {
				commands: ["ls -la", { command: "git", args: ["status", "-sb"] }],
			},
			inProgress: true,
		});
		expect(summary.label).toBe("Running 2 commands");
		expect(summary.details).toEqual(["ls -la", "git status -sb"]);
	});

	it("captures command output text", () => {
		const summary = buildToolSummary({
			toolName: "run_commands",
			input: { commands: ["ls"] },
			result: "a.txt\nb.txt",
		});
		expect(summary.outputText).toBe("a.txt\nb.txt");
	});
});

describe("search / web summaries", () => {
	it("labels a single search query inline", () => {
		const summary = buildToolSummary({
			toolName: "search_codebase",
			input: { queries: ["ToolActivityTrigger"] },
		});
		expect(summary.label).toBe("Searched ToolActivityTrigger");
	});

	it("aggregates multiple queries", () => {
		const summary = buildToolSummary({
			toolName: "search_codebase",
			input: { queries: ["a", "b"] },
		});
		expect(summary.label).toBe("Explored 2 searches");
		expect(summary.details).toEqual(["a", "b"]);
	});

	it("labels single and multiple url fetches", () => {
		expect(
			buildToolSummary({
				toolName: "fetch_web_content",
				input: { requests: [{ url: "https://cline.bot" }] },
			}).label,
		).toBe("Fetched https://cline.bot");
		expect(
			buildToolSummary({
				toolName: "web_fetch",
				input: {
					requests: [{ url: "https://a.dev" }, { url: "https://b.dev" }],
				},
			}).label,
		).toBe("Explored 2 links");
	});
});

describe("editor summaries", () => {
	it("derives diff counts and a unified diff from old/new text", () => {
		const summary = buildToolSummary({
			toolName: "editor",
			input: {
				path: "src/util.ts",
				old_text: "const a = 1;\nconst b = 2;",
				new_text: "const a = 1;\nconst b = 3;\nconst c = 4;",
			},
		});
		expect(summary.label).toBe("Edited file util.ts");
		// The expanded panel leads with the fuller path, like read rows.
		expect(summary.details).toEqual(["src/util.ts"]);
		expect(summary.diff).toEqual({ additions: 2, deletions: 1 });
		const item = summary.items[0];
		expect(item.type).toBe("file");
		if (item.type === "file") {
			expect(item.diff).toContain("--- a/src/util.ts");
			expect(item.diff).toContain("+const c = 4;");
			expect(item.language).toBe("typescript");
			// str_replace texts are file fragments: the hunk header must not
			// fabricate line positions.
			expect(item.diff).toContain("@@ … @@");
			expect(item.diff).not.toMatch(/@@ -\d/);
			// Raw texts feed rich diff renderers (@pierre/diffs).
			expect(item.oldText).toBe("const a = 1;\nconst b = 2;");
			expect(item.newText).toBe("const a = 1;\nconst b = 3;\nconst c = 4;");
			expect(item.fragment).toBe(true);
		}
	});

	it("keeps real hunk positions when creating a whole file", () => {
		const summary = buildToolSummary({
			toolName: "editor",
			input: { path: "new.ts", new_text: "line 1\nline 2" },
		});
		const item = summary.items[0];
		if (item.type === "file") {
			expect(item.diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
		} else {
			expect.unreachable("expected a file item");
		}
	});

	it("treats a create as all additions", () => {
		const summary = buildToolSummary({
			toolName: "editor",
			input: { path: "new.py", new_text: "print(1)\nprint(2)" },
		});
		expect(summary.label).toBe("Created file new.py");
		expect(summary.diff).toEqual({ additions: 2, deletions: 0 });
	});

	it("does not report phantom lines for empty texts", () => {
		const emptied = buildToolSummary({
			toolName: "editor",
			input: { path: "a.ts", old_text: "line", new_text: "" },
		});
		expect(emptied.diff).toEqual({ additions: 0, deletions: 1 });
		const emptyCreate = buildToolSummary({
			toolName: "editor",
			input: { path: "b.ts", new_text: "" },
		});
		expect(emptyCreate.diff).toEqual({ additions: 0, deletions: 0 });
	});

	it("uses in-progress verbs", () => {
		const summary = buildToolSummary({
			toolName: "editor",
			input: { path: "a.ts", old_text: "x", new_text: "y" },
			inProgress: true,
		});
		expect(summary.label).toBe("Editing file a.ts");
	});

	it("falls back to +N:/-N: counts from the result", () => {
		const summary = buildToolSummary({
			toolName: "editor",
			input: { path: "a.ts" },
			result: { result: "+12: added line\n-13: removed line\n+14: another" },
		});
		expect(summary.label).toBe("Edited file a.ts");
		expect(summary.diff).toEqual({ additions: 2, deletions: 1 });
	});
});

describe("apply_patch summaries", () => {
	const patch = [
		"*** Begin Patch",
		"*** Update File: src/one.ts",
		"-old line",
		"+new line",
		"+extra line",
		"*** Add File: src/two.ts",
		"+created",
		"*** End Patch",
	].join("\n");

	it("parses per-file additions and deletions", () => {
		const info = parseApplyPatchInput(patch);
		expect(info?.files.map((f) => f.path)).toEqual([
			"src/one.ts",
			"src/two.ts",
		]);
		expect(info?.files[0]).toMatchObject({ additions: 2, deletions: 1 });
		expect(info?.files[1]).toMatchObject({ additions: 1, deletions: 0 });
		expect(info?.additions).toBe(3);
		expect(info?.deletions).toBe(1);
		expect(info?.files[0].diff).toContain("--- a/src/one.ts");
		expect(info?.files[0].diff).toContain("+new line");
		// Update File sections are fragments (no real positions); Add File
		// sections carry whole contents and keep numeric hunk headers.
		expect(info?.files[0].diff).toContain("@@ … @@");
		expect(info?.files[0].diff).not.toMatch(/@@ -\d/);
		expect(info?.files[1].diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
		// Reconstructed texts for rich diff renderers.
		expect(info?.files[0]).toMatchObject({
			action: "update",
			hunks: [{ oldText: "old line", newText: "new line\nextra line" }],
		});
		expect(info?.files[1]).toMatchObject({
			action: "add",
			hunks: [{ oldText: "", newText: "created" }],
		});
	});

	it("preserves hunk boundaries instead of re-diffing across them", () => {
		const multiHunk = [
			"*** Begin Patch",
			"*** Update File: src/multi.ts",
			"@@ first",
			"-a",
			"+b",
			"@@ second",
			"-b",
			"+c",
			"*** End Patch",
		].join("\n");
		const info = parseApplyPatchInput(multiHunk);
		// Concatenated-and-re-diffed would collapse the -b/+b pair into
		// context; separate hunks keep both changes intact.
		expect(info?.files[0].hunks).toEqual([
			{ oldText: "a", newText: "b" },
			{ oldText: "b", newText: "c" },
		]);
		expect(info?.files[0]).toMatchObject({ additions: 2, deletions: 2 });
		const summary = buildToolSummary({
			toolName: "apply_patch",
			input: multiHunk,
		});
		const item = summary.items[0];
		if (item.type === "file") {
			expect(item.hunks).toHaveLength(2);
			expect(item.oldText).toBeUndefined();
		} else {
			expect.unreachable("expected a file item");
		}
	});

	it("labels deleted and renamed files from their section metadata", () => {
		const patch = [
			"*** Begin Patch",
			"*** Delete File: src/gone.ts",
			"*** End Patch",
		].join("\n");
		const summary = buildToolSummary({ toolName: "apply_patch", input: patch });
		expect(summary.label).toBe("Deleted file gone.ts");
		expect(summary.details).toEqual(["Deleted src/gone.ts"]);
		const item = summary.items[0];
		if (item.type === "file") {
			expect(item.newText).toBeUndefined();
			expect(item.hunks).toBeUndefined();
		}

		const rename = [
			"*** Begin Patch",
			"*** Update File: src/old-name.ts",
			"*** Move to: src/new-name.ts",
			"-a",
			"+b",
			"*** End Patch",
		].join("\n");
		const renamed = buildToolSummary({
			toolName: "apply_patch",
			input: rename,
		});
		expect(renamed.label).toBe("Edited file old-name.ts → new-name.ts");
		expect(renamed.details).toEqual([
			"src/old-name.ts → src/new-name.ts +1 -1",
		]);
	});

	it("labels multi-file patches with counts and per-file details", () => {
		const summary = buildToolSummary({ toolName: "apply_patch", input: patch });
		expect(summary.label).toBe("Edited 2 files");
		expect(summary.diff).toEqual({ additions: 3, deletions: 1 });
		expect(summary.details).toEqual(["src/one.ts +2 -1", "src/two.ts +1 -0"]);
	});

	it("labels single-file patches with the file name", () => {
		const single = [
			"*** Begin Patch",
			"*** Update File: src/only.ts",
			"+added",
			"*** End Patch",
		].join("\n");
		expect(
			buildToolSummary({ toolName: "apply_patch", input: single }).label,
		).toBe("Edited file only.ts");
	});

	it("degrades to a generic label when the envelope is unparsable", () => {
		const summary = buildToolSummary({ toolName: "apply_patch", input: 42 });
		expect(summary.label).toBe("Applied patch");
	});
});

describe("spawn / skill / question summaries", () => {
	it("puts the truncated task inline for spawn_agent", () => {
		const summary = buildToolSummary({
			toolName: "spawn_agent",
			input: { task: "Fix the login bug in auth flow" },
		});
		expect(summary.label).toBe("Spawned agent: Fix the login bug in auth flow");
		expect(summary.details).toEqual(["Fix the login bug in auth flow"]);
	});

	it("labels skills with the skill name", () => {
		const summary = buildToolSummary({
			toolName: "skills",
			input: { skill: "deploy", args: "--prod" },
		});
		expect(summary.label).toBe("Used skill deploy");
		expect(summary.details).toEqual(["deploy --prod"]);
	});

	it("labels questions with the question text and captures the answer", () => {
		const summary = buildToolSummary({
			toolName: "ask_question",
			input: { question: "Which env?", options: ["dev", "prod"] },
			result: "prod",
		});
		expect(summary.label).toBe('Asked "Which env?"');
		expect(summary.details).toEqual(["dev", "prod"]);
		expect(summary.outputText).toBe("prod");
	});
});

describe("team summaries", () => {
	it("labels team_spawn_teammate with the agent id detail", () => {
		const summary = buildToolSummary({
			toolName: "team_spawn_teammate",
			result: { agentId: "researcher-1" },
		});
		expect(summary.label).toBe("Spawned 1 teammate");
		expect(summary.details).toEqual(["researcher-1"]);
		expect(summary.kind).toBe("team");
	});

	it("uses failure labels for errored team tools", () => {
		const summary = buildToolSummary({
			toolName: "team_broadcast",
			isError: true,
		});
		expect(summary.label).toBe("Failed to broadcast message to teammates");
	});
});

describe("fallbacks", () => {
	it("labels input-less events by kind", () => {
		expect(buildToolSummary({ toolName: "read_files" }).label).toBe(
			"Read file",
		);
		expect(
			buildToolSummary({ toolName: "run_commands", inProgress: true }).label,
		).toBe("Running command");
		expect(buildToolSummary({ toolName: "editor" }).label).toBe("Edited file");
		expect(buildToolSummary({ toolName: "search_codebase" }).label).toBe(
			"Searched",
		);
	});

	it("humanizes unknown tool names", () => {
		expect(buildToolSummary({ toolName: "custom-tool" }).label).toBe(
			"Custom tool",
		);
		expect(
			buildToolSummary({ toolName: "custom_tool", inProgress: true }).label,
		).toBe("Running Custom tool");
	});

	it("captures error text from record results", () => {
		const summary = buildToolSummary({
			toolName: "run_commands",
			input: { commands: ["false"] },
			isError: true,
			result: { error: "exit code 1" },
		});
		expect(summary.errorText).toBe("exit code 1");
		expect(summary.outputText).toBeUndefined();
	});

	it("never throws on garbage payloads", () => {
		for (const input of [null, 42, "not json {", [], { files: 7 }, () => {}]) {
			expect(() =>
				buildToolSummary({ toolName: "read_files", input }),
			).not.toThrow();
		}
	});

	it("caps oversized output text", () => {
		const summary = buildToolSummary(
			{
				toolName: "run_commands",
				input: { commands: ["cat big"] },
				result: "x".repeat(200),
			},
			{ maxOutputChars: 50 },
		);
		expect(summary.outputText?.endsWith("[output truncated]")).toBe(true);
	});
});

describe("buildGroupedToolLabel", () => {
	it("merges adjacent same-kind aggregates", () => {
		const summaries = [
			buildToolSummary({
				toolName: "read_files",
				input: { file_paths: ["a.ts"] },
			}),
			buildToolSummary({
				toolName: "read_files",
				input: { file_paths: ["b.ts", "c.ts"] },
			}),
			buildToolSummary({
				toolName: "run_commands",
				input: { commands: ["bun test"] },
			}),
		];
		expect(buildGroupedToolLabel(summaries)).toBe(
			"Read 3 files · Ran 1 command",
		);
	});

	it("keeps single-call labels verbatim", () => {
		const summary = buildToolSummary({
			toolName: "read_files",
			input: { files: [{ path: "a.ts", start_line: 1, end_line: 5 }] },
		});
		expect(buildGroupedToolLabel([summary])).toBe("Read file a.ts (1–5)");
	});

	it("merges input-less fallback summaries into grouped counts", () => {
		const spawns = [1, 2, 3].map(() =>
			buildToolSummary({
				toolName: "subagent_subagent",
				input: { prompt: "Investigate" },
				result: { text: "Done" },
			}),
		);
		expect(buildGroupedToolLabel(spawns)).toBe("Spawned 3 agents");
	});

	it("uses progress verbs when any merged call is in progress", () => {
		const done = buildToolSummary({
			toolName: "read_files",
			input: { file_paths: ["a.ts"] },
		});
		const running = {
			...buildToolSummary({
				toolName: "read_files",
				input: { file_paths: ["b.ts"] },
			}),
			inProgress: true,
		};
		expect(buildGroupedToolLabel([done, running])).toBe("Reading 2 files");
	});
});

// Ported from apps/cli/src/tui/utils/tool-parsing.test.ts so the shared
// module keeps the CLI's parsing behavior.
describe("buildReadFilesKeys (ported from CLI)", () => {
	it("produces unique keys when the same path is read twice", () => {
		const info = parseReadFilesInput({
			files: [{ path: "/a/SKILL.md" }, { path: "/a/SKILL.md" }],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);
		expect(keys).toHaveLength(2);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("produces unique keys for duplicate paths from the file_paths shape", () => {
		const info = parseReadFilesInput({
			file_paths: ["/a/SKILL.md", "/a/SKILL.md", "/b/SKILL.md"],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);
		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("extractOutputText (ported from CLI)", () => {
	it("extracts text with real newlines from the MCP CallToolResult shape", () => {
		const raw = {
			content: [
				{ type: "text", text: "# Memory\n\nline one" },
				{ type: "text", text: "line two" },
			],
		};
		expect(extractOutputText(raw)).toBe("# Memory\n\nline one\nline two");
	});

	it("keeps binary payloads behind placeholders in mixed MCP content", () => {
		const raw = {
			content: [
				{ type: "text", text: "before" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				{
					type: "resource",
					resource: { uri: "file:///a.md", blob: "d29ybGQ=" },
				},
				{ type: "resource_link", uri: "file:///b.md", name: "b.md" },
				{ type: "text", text: "after" },
			],
		};
		expect(extractOutputText(raw)).toBe(
			"before\n[image: image/png]\naGVsbG8=\n[resource: file:///a.md]\nd29ybGQ=\n[resource_link: file:///b.md]\nafter",
		);
	});

	it("chunks base64 payloads into 76-char lines so collapse stays compact", () => {
		const raw = {
			content: [
				{ type: "image", data: "A".repeat(160), mimeType: "image/png" },
			],
		};
		expect(extractOutputText(raw)?.split("\n")).toEqual([
			"[image: image/png]",
			"A".repeat(76),
			"A".repeat(76),
			"A".repeat(8),
		]);
	});

	it("extracts embedded resource text from MCP content", () => {
		const raw = {
			content: [
				{
					type: "resource",
					resource: { uri: "file:///memory.md", text: "resource body\nline 2" },
				},
			],
		};
		expect(extractOutputText(raw)).toBe("resource body\nline 2");
	});

	it("falls back to pretty JSON for objects without text content", () => {
		const raw = { structuredContent: { ok: true } };
		expect(extractOutputText(raw)).toBe(JSON.stringify(raw, null, 2));
	});

	it("extracts text from [{result}] arrays", () => {
		expect(extractOutputText([{ result: "line" }])).toBe("line");
	});
});

describe("shortenPath", () => {
	it("keeps short paths and shortens long ones from the tail", () => {
		expect(shortenPath("src/a.ts")).toBe("src/a.ts");
		const long = "one/two/three/four/five/six/seven/eight/nine/file-name.ts";
		const short = shortenPath(long);
		expect(short.length).toBeLessThanOrEqual(50);
		expect(short.startsWith(".../")).toBe(true);
		expect(short.endsWith("file-name.ts")).toBe(true);
	});
});
