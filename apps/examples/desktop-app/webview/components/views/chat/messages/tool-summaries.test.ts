import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	buildGroupedToolLabel,
	buildToolPresentation,
	buildToolSummary,
	buildToolSummaryFromMeta,
	classifyTool,
	extractCommands,
	extractReadFilePaths,
	normalizeToolName,
	parseDiffCounts,
	teamSummary,
	toDisplayPath,
} from "./tool-summaries";

function makeToolMessage(
	payload: unknown,
	overrides: Partial<ChatMessage> = {},
): ChatMessage {
	return {
		id: "tool-1",
		sessionId: "session-1",
		role: "tool",
		content: JSON.stringify(payload),
		createdAt: 1,
		...overrides,
	} as ChatMessage;
}

describe("normalizeToolName / classifyTool", () => {
	it("maps aliases onto canonical tool names", () => {
		expect(normalizeToolName("bash")).toBe("run_commands");
		expect(normalizeToolName("apply-patch")).toBe("apply_patch");
		expect(normalizeToolName("Edit_File")).toBe("editor");
		expect(normalizeToolName("web-fetch")).toBe("fetch_web_content");
	});

	it("classifies tools into kinds", () => {
		expect(classifyTool("read_files")).toBe("exploration");
		expect(classifyTool("apply_patch")).toBe("file-edit");
		expect(classifyTool("bash")).toBe("bash");
		expect(classifyTool("subagent_code_reviewer")).toBe("spawn");
		expect(classifyTool("unknown_tool")).toBe("tool");
	});
});

describe("extractReadFilePaths", () => {
	it("accepts the shape zoo read_files inputs arrive in", () => {
		expect(
			extractReadFilePaths({ files: [{ path: "a.ts" }, { path: "b.ts" }] }),
		).toEqual(["a.ts", "b.ts"]);
		expect(extractReadFilePaths({ files: "single.ts" })).toEqual(["single.ts"]);
		expect(extractReadFilePaths({ file_paths: ["x.ts"] })).toEqual(["x.ts"]);
		expect(extractReadFilePaths({ paths: ["y.ts", "z.ts"] })).toEqual([
			"y.ts",
			"z.ts",
		]);
		expect(extractReadFilePaths(["direct.ts"])).toEqual(["direct.ts"]);
		expect(extractReadFilePaths("bare.ts")).toEqual(["bare.ts"]);
	});

	it("ignores entries without a usable path", () => {
		expect(extractReadFilePaths({ files: [{}, { path: "" }, 42] })).toEqual([]);
		expect(extractReadFilePaths(null)).toEqual([]);
	});
});

describe("extractCommands", () => {
	it("reads shell strings and structured command entries", () => {
		expect(extractCommands({ commands: ["ls -la", "pwd"] })).toEqual([
			"ls -la",
			"pwd",
		]);
		expect(
			extractCommands({
				commands: [{ command: "git", args: ["status", "-s"] }],
			}),
		).toEqual(["git status -s"]);
		expect(extractCommands({ command: "echo hi" })).toEqual(["echo hi"]);
		expect(extractCommands("bare command")).toEqual(["bare command"]);
	});

	it("drops malformed entries", () => {
		expect(extractCommands({ commands: [42, {}, ""] })).toEqual([]);
	});
});

describe("parseDiffCounts", () => {
	it("counts editor-style +N:/-N: line markers", () => {
		const diff = "+1: added\n-2: removed\n+3: another\ncontext";
		expect(parseDiffCounts(diff)).toEqual({ additions: 2, deletions: 1 });
	});

	it("returns null for non-strings and diff-less strings", () => {
		expect(parseDiffCounts(undefined)).toBeNull();
		expect(parseDiffCounts("no markers here")).toBeNull();
	});
});

describe("toDisplayPath", () => {
	it("keeps only the basename across path separators", () => {
		expect(toDisplayPath("src/lib/utils.ts")).toBe("utils.ts");
		expect(toDisplayPath("C:\\repo\\file.ts")).toBe("file.ts");
		expect(toDisplayPath("plain.ts")).toBe("plain.ts");
	});
});

describe("buildToolSummary", () => {
	it("summarizes read_files with per-file details and an aggregate", () => {
		const summary = buildToolSummary(
			"read_files",
			{ paths: ["src/a.ts", "src/b.ts"] },
			{},
			false,
		);
		expect(summary.label).toBe("Read 2 files");
		expect(summary.aggregate?.key).toBe("read-files");
		expect(summary.details).toEqual(["Read a.ts", "Read b.ts"]);
	});

	it("uses progress verbs while a tool call is in flight", () => {
		const summary = buildToolSummary(
			"run_commands",
			{ commands: ["bun test"] },
			null,
			true,
		);
		expect(summary.label).toBe("Running 1 command");
		expect(summary.details).toEqual(["bun test"]);
	});

	it("summarizes search_codebase queries", () => {
		const summary = buildToolSummary(
			"search_codebase",
			{ queries: ["foo", "bar"] },
			{},
			false,
		);
		// Current behavior: pluralize() defaults to `${singular}s` and the
		// search_codebase branch passes no pluralNoun, so this reads "searchs".
		expect(summary.label).toBe("Explored 2 searchs");
		expect(summary.details).toEqual(["foo", "bar"]);
	});

	it("summarizes fetch_web_content urls", () => {
		const summary = buildToolSummary(
			"fetch_web_content",
			{ requests: [{ url: "https://cline.bot" }] },
			{},
			false,
		);
		expect(summary.label).toBe("Explored 1 link");
		expect(summary.details).toEqual(["Fetched https://cline.bot"]);
	});

	it("summarizes apply_patch with diff counts from the patch text", () => {
		const patch = [
			"*** Begin Patch",
			"*** Add File: src/new-file.ts",
			"+line one",
			"+line two",
			"*** End Patch",
		].join("\n");
		const summary = buildToolSummary(
			"apply_patch",
			{ input: patch },
			{},
			false,
		);
		expect(summary.label).toBe("Edited 1 file");
		expect(summary.diff).toEqual({ additions: 2, deletions: 0 });
		expect(summary.details).toEqual(["Edited new-file.ts +2 -0"]);
	});

	it("falls back to a generic apply_patch label without parseable input", () => {
		const summary = buildToolSummary("apply_patch", {}, {}, true);
		expect(summary.label).toBe("Applying patch");
	});

	it("derives the editor action from the input shape", () => {
		const replace = buildToolSummary(
			"editor",
			{ path: "src/thing.ts", old_text: "a" },
			{},
			false,
		);
		expect(replace.label).toBe("Edited thing.ts");

		const create = buildToolSummary(
			"editor",
			{ path: "src/created.ts", new_text: "content" },
			{ result: "+1: content" },
			false,
		);
		expect(create.label).toBe("Created created.ts");
		expect(create.diff).toEqual({ additions: 1, deletions: 0 });
	});

	it("renames subagent tools to spawn_agent in the fallback label", () => {
		const summary = buildToolSummary("subagent_reviewer", {}, null, true);
		expect(summary.label).toBe("Running spawn_agent");
	});
});

describe("teamSummary", () => {
	it("returns null for non-team tools", () => {
		expect(teamSummary("read_files", {}, {}, false, false)).toBeNull();
	});

	it("uses spawn verbs and surfaces the agent id", () => {
		const inProgress = teamSummary(
			"team_spawn_teammate",
			{ agentId: "worker-1" },
			null,
			true,
			false,
		);
		expect(inProgress?.label).toBe("Spawning 1 teammate");
		expect(inProgress?.details).toEqual(["worker-1"]);

		const done = teamSummary(
			"team_spawn_teammate",
			{},
			{ agentId: "worker-1" },
			false,
			false,
		);
		expect(done?.label).toBe("Spawned 1 teammate");
	});

	it("maps team_task actions onto their verb pairs", () => {
		const created = teamSummary(
			"team_task",
			{ action: "create", taskId: "T1", title: "Do the thing" },
			{},
			false,
			false,
		);
		expect(created?.label).toBe("Created 1 team task");
		expect(created?.details).toEqual(["T1 Do the thing"]);

		const listed = teamSummary(
			"team_task",
			{ action: "list" },
			{
				tasks: [
					{ id: "T1", status: "open" },
					{ id: "T2", status: "done" },
				],
			},
			false,
			false,
		);
		expect(listed?.label).toBe("Listed 2 team tasks");
	});

	it("counts broadcast deliveries from the result", () => {
		const summary = teamSummary(
			"team_broadcast",
			{ subject: "standup" },
			{ delivered: 3 },
			false,
			false,
		);
		expect(summary?.label).toBe("Broadcast message to 3 teammates");
		expect(summary?.details).toEqual(["standup"]);
	});

	it("returns the failure label table on errors", () => {
		const summary = teamSummary("team_spawn_teammate", {}, {}, false, true);
		expect(summary?.label).toBe("Failed to spawn teammate");

		const unknown = teamSummary("team_new_tool", {}, {}, false, true);
		expect(unknown?.label).toBe("Failed team_new_tool");
	});
});

describe("buildToolSummaryFromMeta", () => {
	it("labels each tool kind with progress and completed variants", () => {
		expect(buildToolSummaryFromMeta("search", "exploration", true).label).toBe(
			"Exploring",
		);
		expect(buildToolSummaryFromMeta("editor", "file-edit", false).label).toBe(
			"Edited",
		);
		expect(buildToolSummaryFromMeta("bash", "bash", false).label).toBe(
			"Ran command",
		);
		expect(buildToolSummaryFromMeta("spawn_agent", "spawn", true).label).toBe(
			"Spawning agent",
		);
		expect(buildToolSummaryFromMeta("mystery", "tool", false).label).toBe(
			"mystery",
		);
	});
});

describe("buildToolPresentation", () => {
	it("marks a payload without a result as in progress", () => {
		const presentation = buildToolPresentation(
			makeToolMessage({ toolName: "read_files", input: {}, result: null }),
		);
		expect(presentation.inProgress).toBe(true);
		expect(presentation.toolName).toBe("read_files");
	});

	it("prefers the meta tool name and falls back to meta-only summaries for unparseable payloads", () => {
		const presentation = buildToolPresentation(
			makeToolMessage("not-json", {
				content: "not-json",
				meta: { toolName: "search" },
			}),
		);
		expect(presentation.payload).toBeNull();
		expect(presentation.kind).toBe("exploration");
		expect(presentation.summary.label).toBe("Explored");
	});

	it("treats tool_call_start hook events as in progress", () => {
		const presentation = buildToolPresentation(
			makeToolMessage(
				{ toolName: "run_commands", input: {}, result: { ok: true } },
				{
					meta: { toolName: "run_commands", hookEventName: "tool_call_start" },
				},
			),
		);
		expect(presentation.inProgress).toBe(true);
	});
});

describe("buildGroupedToolLabel", () => {
	function presentationFor(payload: {
		toolName: string;
		input?: unknown;
		result?: unknown;
	}) {
		return buildToolPresentation(
			makeToolMessage({ result: {}, ...payload }, { id: payload.toolName }),
		);
	}

	it("returns the single summary label untouched", () => {
		const only = presentationFor({
			toolName: "read_files",
			input: { paths: ["a.ts"] },
		});
		expect(buildGroupedToolLabel([only])).toBe("Read 1 file");
	});

	it("merges consecutive aggregates that share a key", () => {
		const first = presentationFor({
			toolName: "read_files",
			input: { paths: ["a.ts", "b.ts"] },
		});
		const second = presentationFor({
			toolName: "read_files",
			input: { paths: ["c.ts"] },
		});
		expect(buildGroupedToolLabel([first, second])).toBe("Read 3 files");
	});

	it("joins non-mergeable segments with periods and keeps progress verbs", () => {
		const reads = presentationFor({
			toolName: "read_files",
			input: { paths: ["a.ts"] },
		});
		const running = buildToolPresentation(
			makeToolMessage(
				{
					toolName: "run_commands",
					input: { commands: ["bun test"] },
					result: null,
				},
				{ id: "cmd" },
			),
		);
		expect(buildGroupedToolLabel([reads, running])).toBe(
			"Read 1 file. Running 1 command",
		);
	});
});
