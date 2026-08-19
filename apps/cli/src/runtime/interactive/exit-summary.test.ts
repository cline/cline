import type { SessionRecord } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	createInteractiveExitSummary,
	formatInteractiveExitSummary,
} from "./exit-summary";

function makeSessionRecord(
	overrides: Partial<SessionRecord> = {},
): SessionRecord {
	return {
		sessionId: "sess_123",
		source: "cli",
		pid: 123,
		startedAt: "2026-04-29T10:00:00.000Z",
		endedAt: null,
		exitCode: null,
		status: "running",
		interactive: true,
		provider: "cline",
		model: "openai/gpt-5.3-codex",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		enableTools: true,
		enableSpawn: true,
		enableTeams: false,
		isSubagent: false,
		metadata: { totalCost: 0.125 },
		messagesPath: "/tmp/project/sess_123.messages.json",
		updatedAt: "2026-04-29T10:01:00.000Z",
		...overrides,
	};
}

describe("interactive exit summary", () => {
	it("skips sessions that were never persisted and have no messages", () => {
		const summary = createInteractiveExitSummary({
			sessionId: "sess_empty",
			row: makeSessionRecord({ messagesPath: undefined }),
			messages: [],
		});

		expect(summary).toBeUndefined();
	});

	it("creates a summary from persisted session information", () => {
		const summary = createInteractiveExitSummary({
			sessionId: "sess_123",
			row: makeSessionRecord(),
			messages: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi" },
			],
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.25,
			},
		});

		expect(summary).toEqual({
			sessionId: "sess_123",
			startedAt: "2026-04-29T10:00:00.000Z",
			provider: "cline",
			model: "openai/gpt-5.3-codex",
			cwd: "/tmp/project",
			messageCount: 2,
			totalCost: 0.25,
		});
	});

	it("formats the continue command for graceful TUI shutdown", () => {
		const output = formatInteractiveExitSummary({
			sessionId: "sess_123",
			startedAt: "2026-04-29T10:00:00.000Z",
			provider: "cline",
			model: "openai/gpt-5.3-codex",
			cwd: "/tmp/project",
			messageCount: 2,
			totalCost: 0.25,
		});

		expect(output).toContain("Session Summary");
		expect(output).toContain("  ID        sess_123");
		expect(output).toContain("  Model     cline:openai/gpt-5.3-codex");
		expect(output).toContain("  Messages  2");
		expect(output).toContain("  Cost      $0.250000");
		expect(output).toContain("  Continue  ");
		expect(output).toContain("cline --id sess_123");
	});

	it("formats an invalid start time without leaking NaN", () => {
		const output = formatInteractiveExitSummary({
			sessionId: "sess_123",
			startedAt: "not-a-date",
			messageCount: 1,
		});

		expect(output).toContain("  Duration  0s");
		expect(output).not.toContain("NaN");
	});

	it("omits cost for subscription-backed providers", () => {
		const output = formatInteractiveExitSummary({
			sessionId: "sess_123",
			startedAt: "2026-04-29T10:00:00.000Z",
			provider: "openai-codex",
			model: "gpt-5.4",
			messageCount: 2,
			totalCost: 0.25,
		});

		expect(output).not.toContain("  Cost");
		expect(output).not.toContain("$0.250000");
	});
});
