import type { SessionReplayIteration } from "@cline/session";
import { describe, expect, it } from "vitest";
import {
	formatReplayDecisions,
	formatReplayDuration,
	formatReplayEventTimeline,
	formatReplayIterationText,
	formatReplayModelCalls,
	replayDelayMs,
	truncateLines,
} from "./replay";

function iteration(
	overrides: Partial<SessionReplayIteration> = {},
): SessionReplayIteration {
	return {
		index: 1,
		turn: 1,
		sessionId: "sess_1",
		toolCalls: [],
		timing: {},
		events: [],
		messageRange: { start: 0, end: 1 },
		...overrides,
	};
}

describe("replayDelayMs", () => {
	it("scales recorded gaps by speed and caps them", () => {
		const gap = iteration({ timing: { sincePreviousMs: 2_000 } });
		expect(replayDelayMs(gap, 1)).toBe(2_000);
		expect(replayDelayMs(gap, 4)).toBe(500);
		expect(replayDelayMs(gap, 0)).toBe(0);
		expect(
			replayDelayMs(iteration({ timing: { sincePreviousMs: 60_000 } }), 1),
		).toBe(3_000);
		expect(replayDelayMs(iteration(), 1)).toBe(0);
	});
});

describe("formatReplayDuration", () => {
	it("picks a unit by magnitude", () => {
		expect(formatReplayDuration(250)).toBe("250ms");
		expect(formatReplayDuration(1_500)).toBe("1.5s");
		expect(formatReplayDuration(125_000)).toBe("2m 05s");
		expect(formatReplayDuration(-1)).toBe("-");
	});
});

describe("formatReplayEventTimeline", () => {
	it("shows event offsets from the iteration start", () => {
		expect(
			formatReplayEventTimeline(
				iteration({
					timing: { startedAt: "2026-01-01T00:00:00.000Z" },
					events: [
						{
							index: 0,
							ts: "2026-01-01T00:00:01.100Z",
							kind: "hook",
							name: "tool_call",
							toolCallId: "call_1",
						},
						{
							index: 1,
							ts: "2026-01-01T00:00:00.400Z",
							kind: "hook",
							name: "agent_end",
						},
					],
				}),
			),
		).toEqual(["+1.1s tool_call call_1", "+400ms agent_end"]);
	});

	it("leaves recorded decisions and runtime events out of the hook timeline", () => {
		expect(
			formatReplayEventTimeline(
				iteration({
					events: [
						{ index: 0, ts: "t", kind: "decision", name: "approval_resolved" },
						{ index: 1, ts: "t", kind: "runtime", name: "tool_started" },
					],
				}),
			),
		).toEqual([]);
	});
});

describe("recorded sessions", () => {
	const recorded = iteration({
		timing: { startedAt: "2026-01-01T00:00:00.000Z" },
		events: [
			{
				index: 0,
				ts: "2026-01-01T00:00:00.000Z",
				kind: "decision",
				name: "prompt_delivered",
				seq: 0,
				detail: "immediate prompt delivered (start)",
			},
			{
				index: 1,
				ts: "2026-01-01T00:00:01.200Z",
				kind: "decision",
				name: "approval_resolved",
				seq: 7,
				detail: "approved run_commands by client (cli) after 900ms",
			},
			{
				index: 2,
				ts: "2026-01-01T00:00:01.300Z",
				kind: "decision",
				name: "custom_decision",
				seq: 8,
			},
		],
		modelCalls: [
			{
				callIndex: 3,
				seq: 5,
				runId: "run_1",
				iteration: 1,
				attempt: 0,
				outcome: "error",
				finishReason: null,
				durationMs: 80,
				matchKey: "a".repeat(64),
				messageCount: 1,
				error: "rate limited",
			},
			{
				callIndex: 4,
				seq: 6,
				runId: "run_1",
				iteration: 1,
				attempt: 1,
				outcome: "completed",
				finishReason: "tool-calls",
				durationMs: 1_200,
				matchKey: "b".repeat(64),
				messageCount: 1,
				messageId: "msg_1",
				usage: { inputTokens: 812, outputTokens: 40 },
			},
		],
	});

	it("formats decisions with their offset, falling back to the event name", () => {
		expect(formatReplayDecisions(recorded)).toEqual([
			"+0ms immediate prompt delivered (start)",
			"+1.2s approved run_commands by client (cli) after 900ms",
			"+1.3s custom_decision",
		]);
	});

	it("formats model calls including failed attempts", () => {
		expect(formatReplayModelCalls(recorded)).toEqual([
			`call 3 · error · 80ms · 1 message · match aaaaaaaaaaaa · rate limited`,
			`call 4 (attempt 2) · completed (tool-calls) · 1.2s · 1 message · 812 in / 40 out · match bbbbbbbbbbbb`,
		]);
		expect(formatReplayModelCalls(iteration())).toEqual([]);
	});

	it("renders decisions and model calls in the iteration text", () => {
		const lines = formatReplayIterationText(recorded, 1, {
			color: false,
			maxResultLines: 0,
		}).split("\n");
		expect(lines).toContain(
			"  decision +1.2s approved run_commands by client (cli) after 900ms",
		);
		expect(lines).toContain(
			"  model call: call 4 (attempt 2) · completed (tool-calls) · 1.2s · 1 message · 812 in / 40 out · match bbbbbbbbbbbb",
		);
	});
});

describe("formatReplayIterationText", () => {
	it("truncates long tool results and flags unanswered prompts", () => {
		const text = formatReplayIterationText(
			iteration({
				prompt: { text: "go" },
				toolCalls: [
					{
						id: "call_1",
						name: "read_files",
						input: { file_paths: ["a"] },
						execution: "client",
						result: { text: "1\n2\n3\n4", isError: true, content: "" },
					},
				],
			}),
			1,
			{ color: false, maxResultLines: 2 },
		);
		expect(text.split("\n")).toEqual([
			"── Iteration 1/1 · turn 1 ──",
			"❯ go",
			"  (no model response recorded)",
			"  tool read_files call_1 · error",
			'      input:  {"file_paths":["a"]}',
			"      result: 1",
			"              2",
			"              … 2 more lines",
		]);
	});

	it("truncateLines leaves short text alone", () => {
		expect(truncateLines("a\nb", 5)).toEqual({ text: "a\nb", hiddenLines: 0 });
		expect(truncateLines("a\nb\nc", 0)).toEqual({
			text: "a\nb\nc",
			hiddenLines: 0,
		});
	});
});
