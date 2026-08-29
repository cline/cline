import { describe, expect, it } from "vitest";
import { formatToolInput, formatToolOutput, truncate } from "./tool-format";

describe("format helpers", () => {
	it("truncates run_commands with commands array", () => {
		const result = formatToolInput("run_commands", {
			commands: [
				"echo hello",
				"npm run very-very-long-command-name-that-will-truncate",
			],
		});
		expect(result).toContain("echo hello");
		expect(result.length).toBeLessThanOrEqual(120);
	});

	it("truncates run_commands with commands as single string", () => {
		const longCmd = `echo ${"x".repeat(200)}`;
		const result = formatToolInput("run_commands", { commands: longCmd });
		expect(result).toContain("echo");
		expect(result.length).toBeLessThanOrEqual(120);
	});

	it("truncates run_commands with bare string input", () => {
		const longCmd = `echo ${"x".repeat(200)}`;
		const result = formatToolInput("run_commands", longCmd);
		expect(result).toContain("echo");
		expect(result.length).toBeLessThanOrEqual(120);
	});

	it("truncates run_commands with bare string array input", () => {
		const result = formatToolInput("run_commands", [
			"echo hello",
			"echo world",
		]);
		expect(result).toContain("echo hello; echo world");
	});

	it("truncates run_commands with structured command input", () => {
		const result = formatToolInput("run_commands", {
			commands: [{ command: "git", args: ["status", "--short"] }],
		});
		expect(result).toContain("git status --short");
	});

	it("truncates run_commands with bare structured command", () => {
		const result = formatToolInput("run_commands", {
			command: "git",
			args: ["log", "--oneline"],
		});
		expect(result).toContain("git log --oneline");
	});

	it("handles structured command with non-array args gracefully", () => {
		const result = formatToolInput("run_commands", {
			commands: [{ command: "git", args: "status" }],
		});
		expect(result).toBe("git");
	});

	it("formats known tool input payloads with truncation", () => {
		expect(
			formatToolInput("team_run_task", {
				runMode: "sync",
				agentId: "coder",
				task: "implement feature with extensive acceptance criteria and checks",
			}),
		).toContain("sync coder:");
		expect(
			formatToolInput("team_member", {
				action: "spawn",
				agentId: "reviewer",
				rolePrompt: "Review changes and call out risks",
			}),
		).toContain("spawn reviewer:");
		expect(
			formatToolInput("team_task", {
				action: "complete",
				taskId: "task_0012",
				summary: "Done and verified",
			}),
		).toContain("complete task_0012:");
		expect(
			formatToolInput("team_message", {
				action: "send",
				toAgentId: "lead",
				subject: "Status update",
			}),
		).toContain("send lead:");
	});

	it("formats ask_question as a readable prompt", () => {
		expect(
			formatToolInput("ask_question", {
				question: "How can I best assist you today?",
				options: [
					"Help me understand or analyze code in a repository",
					"Help me create or edit files",
					"Help me run commands or tests",
				],
			}),
		).toBe(
			[
				"The agent is waiting for your input.",
				"How can I best assist you today?",
				"1. Help me understand or analyze code in a repository",
				"2. Help me create or edit files",
				"3. Help me run commands or tests",
				"> Reply with an option number or type your answer.",
			].join("\n"),
		);
	});

	it("summarizes structured tool outputs", () => {
		expect(formatToolOutput("simple text output")).toBe("simple text output");
		expect(
			formatToolOutput([
				{ result: "first" },
				{ result: "second" },
				{ result: "third" },
			]),
		).toBe("first (+2 more)");
		expect(formatToolOutput(null)).toBe("");
	});

	// Regression tests for https://github.com/cline/cline/issues/13036:
	// malformed tool inputs crossing the model/tool boundary must never
	// throw from display-only formatters.
	it("does not crash on run_commands with a null command", () => {
		expect(formatToolInput("run_commands", { command: null })).toBe("");
	});

	it("does not crash on run_commands with a non-string command", () => {
		expect(formatToolInput("run_commands", { command: { nested: true } })).toBe(
			'{"nested":true}',
		);
		expect(formatToolInput("run_commands", { commands: { command: 42 } })).toBe(
			"42",
		);
	});

	it("keeps valid empty-string args in structured command summaries", () => {
		expect(
			formatToolInput("run_commands", {
				commands: [{ command: "grep", args: ["", "pattern", "file.txt"] }],
			}),
		).toBe("grep  pattern file.txt");
		expect(
			formatToolInput("run_commands", {
				commands: [{ command: "git", args: [null, "status", undefined] }],
			}),
		).toBe("git status");
	});

	it("skips null entries in run_commands command arrays", () => {
		expect(
			formatToolInput("run_commands", { commands: [null, "echo hi"] }),
		).toBe("echo hi");
		expect(formatToolInput("run_commands", [undefined, "echo hi"])).toBe(
			"echo hi",
		);
	});

	it("does not crash on fetch_web_content with malformed requests", () => {
		expect(
			formatToolInput("fetch_web_content", {
				requests: [null, { url: "https://example.com" }, { url: 42 }, "raw"],
			}),
		).toBe("https://example.com, 42");
	});

	it("falls back to an empty summary for unserializable inputs", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(formatToolInput("unknown_tool", circular)).toBe("");
		expect(formatToolOutput(circular)).toBe("");
		expect(
			formatToolInput("unknown_tool", {
				toJSON() {
					throw new Error("boom");
				},
			}),
		).toBe("");
	});

	it("truncates non-string values without throwing", () => {
		expect(truncate(null, 10)).toBe("");
		expect(truncate(undefined, 10)).toBe("");
		expect(truncate(42, 10)).toBe("42");
		expect(truncate({ nested: true }, 60)).toBe('{"nested":true}');
	});
});
