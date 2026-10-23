import { EventEmitter } from "node:events";
import type { AgentToolContext } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_LINE_CHARS, MAX_SEARCH_OUTPUT_CHARS } from "./output-limits";
import { createSearchExecutor } from "./search";

const { spawn, getFileIndex } = vi.hoisted(() => ({
	spawn: vi.fn(),
	getFileIndex: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn }));
vi.mock("../../../services/workspace", () => ({ getFileIndex }));

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

// Match and context events carry separate lines, between per-file begin/end events.
function fileEvents(file: string, lines: string[]) {
	const path = { text: file };
	return [
		{ type: "begin", data: { path } },
		...lines.map((text, index) => {
			const start = text.indexOf("needle");
			return {
				type: start < 0 ? "context" : "match",
				data: {
					path,
					line_number: index + 1,
					lines: { text },
					submatches:
						start < 0
							? []
							: [{ match: { text: "needle" }, start, end: start + 6 }],
				},
			};
		}),
		{ type: "end", data: { path } },
	];
}

function mockRipgrep(events: ReturnType<typeof fileEvents>) {
	spawn.mockImplementation((_command: string, args: string[]) => {
		const child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			killed: false,
			kill: vi.fn(() => {
				child.killed = true;
				return true;
			}),
		});
		queueMicrotask(() => {
			if (args.includes("--json")) {
				child.stdout.emit(
					"data",
					`${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
				);
			}
			child.emit("close", 0);
		});
		return child;
	});
}

describe("createSearchExecutor ripgrep results", () => {
	beforeEach(() => {
		spawn.mockReset();
		getFileIndex.mockReset();
		getFileIndex.mockRejectedValue(new Error("Unexpected fallback scan"));
	});

	it.each([
		"\n",
		"\r\n",
		"",
	])("includes the full matching line with no context (line ending %j)", async (ending) => {
		mockRipgrep(fileEvents("alpha.txt", [`  needle value  ${ending}`]));
		const result = await createSearchExecutor({ contextLines: 0 })(
			"needle",
			"/workspace",
			ctx,
		);
		expect(result).toBe(
			"Found 1 result for pattern: needle\n\nalpha.txt:1:3\n> 1:   needle value  \n",
		);
	});

	it("keeps leading, matching, and trailing lines with their own file", async () => {
		mockRipgrep(
			["alpha", "beta"].flatMap((name) =>
				fileEvents(`${name}.txt`, [
					`${name} before\n`,
					`${name} needle\n`,
					`${name} after\n`,
				]),
			),
		);
		const result = await createSearchExecutor({ contextLines: 1 })(
			"needle",
			"/workspace",
			ctx,
		);
		expect(result.split("\n\n").slice(1)).toEqual([
			"alpha.txt:2:7\n  1: alpha before\n> 2: alpha needle\n  3: alpha after",
			"beta.txt:2:6\n  1: beta before\n> 2: beta needle\n  3: beta after\n",
		]);
	});

	it("retains trailing context at the result limit without including the next file", async () => {
		mockRipgrep(
			["alpha", "beta"].flatMap((name) =>
				fileEvents(`${name}.txt`, [
					`${name} before\n`,
					`${name} needle\n`,
					`${name} after\n`,
				]),
			),
		);
		const result = await createSearchExecutor({
			contextLines: 1,
			maxResults: 1,
		})("needle", "/workspace", ctx);
		expect(result).toContain(
			"alpha.txt:2:7\n  1: alpha before\n> 2: alpha needle\n  3: alpha after",
		);
		expect(result).toContain("Found 1 result");
		expect(result).toContain("Showing first 1 results");
		expect(result).not.toContain("beta");
	});

	it("bounds long matching lines when context windows overlap", async () => {
		mockRipgrep(
			fileEvents(
				"large.txt",
				Array.from({ length: 30 }, () => `needle ${"x".repeat(100_000)}\n`),
			),
		);
		const result = await createSearchExecutor({ contextLines: 30 })(
			"needle",
			"/workspace",
			ctx,
		);
		expect(result).toContain("Found 30 results");
		expect(result).toContain(`> 1: needle ${"x".repeat(MAX_LINE_CHARS - 7)}\n`);
		expect(result).toContain("search output truncated");
		expect(result.length).toBeLessThan(MAX_SEARCH_OUTPUT_CHARS + 200);
	});

	it.each([
		1, 2,
	])("uses adjacent matches as context within each line range (limit %i)", async (maxResults) => {
		// rg can emit adjacent match events even with --max-count=1.
		mockRipgrep(
			fileEvents("alpha.txt", ["before\n", "needle one\n", "needle two\n"]),
		);
		const result = await createSearchExecutor({ contextLines: 1, maxResults })(
			"needle",
			"/workspace",
			ctx,
		);
		expect(result.split("\n\n")[1]).toBe(
			"alpha.txt:2:1\n  1: before\n> 2: needle one\n  3: needle two",
		);
		if (maxResults === 2) {
			expect(result.split("\n\n")[2]).toBe(
				"alpha.txt:3:1\n  2: needle one\n> 3: needle two",
			);
		} else {
			expect(result).not.toContain("alpha.txt:3:1");
		}
	});
});
