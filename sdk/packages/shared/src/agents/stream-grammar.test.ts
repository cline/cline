/**
 * Unit tests for the v1 stream grammar validator.
 *
 * These tests use hand-built traces — they test the *tables*. The
 * cross-module guarantee ("the real producer's output validates
 * wart-only") lives in
 * `packages/core/src/runtime/orchestration/runtime-event-adapter.grammar.test.ts`,
 * which drives the real RuntimeEventAdapter.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./types";
import {
	AFTER_TERMINAL,
	DOUBLE_TERMINAL,
	ITERATION_END_WITHOUT_START,
	ITERATION_OVERLAP,
	ITERATION_REGRESSION,
	CONTENT_OUTSIDE_ITERATION,
	TOOL_END_WITHOUT_OPEN,
	TOOL_OPEN_AT_ITERATION_END,
	TOOL_OPEN_WHILE_OPEN,
	TOOL_UPDATE_WITHOUT_OPEN,
	WART_DANGLING_AT_TERMINAL,
	WART_FINAL_WITHOUT_DELTAS,
	WART_START_AS_DELTA,
	WART_TERMINAL_AMBIGUITY,
	validateAgentEventStream,
} from "./stream-grammar";

const iterStart = (iteration = 1): AgentEvent => ({
	type: "iteration_start",
	iteration,
});
const iterEnd = (iteration = 1): AgentEvent => ({
	type: "iteration_end",
	iteration,
	hadToolCalls: false,
	toolCallCount: 0,
});
const textStart = (text: string): AgentEvent => ({
	type: "content_start",
	contentType: "text",
	text,
});
const textEnd = (text: string): AgentEvent => ({
	type: "content_end",
	contentType: "text",
	text,
});
const reasoningStart = (text: string): AgentEvent => ({
	type: "content_start",
	contentType: "reasoning",
	reasoning: text,
});
const toolOpen = (toolCallId: string): AgentEvent => ({
	type: "content_start",
	contentType: "tool",
	toolName: "read_file",
	toolCallId,
	input: {},
});
const toolUpdate = (toolCallId: string): AgentEvent => ({
	type: "content_update",
	contentType: "tool",
	toolCallId,
	update: {},
});
const toolClose = (toolCallId: string): AgentEvent => ({
	type: "content_end",
	contentType: "tool",
	toolCallId,
	toolName: "read_file",
	output: "ok",
});
const done = (reason = "completed"): AgentEvent => ({
	type: "done",
	reason,
	text: "ok",
	iterations: 1,
});
const errorEvent = (recoverable: boolean): AgentEvent => ({
	type: "error",
	error: new Error("boom"),
	recoverable,
});
const notice = (): AgentEvent => ({
	type: "notice",
	noticeType: "status",
	message: "thinking",
	displayRole: "status",
});
const usage = (): AgentEvent => ({
	type: "usage",
	inputTokens: 1,
	outputTokens: 1,
	totalInputTokens: 1,
	totalOutputTokens: 1,
});

describe("stream grammar — legal traces", () => {
	it("accepts a complete streamed turn with a tool call", () => {
		const trace = [
			iterStart(1),
			reasoningStart("hmm"),
			textStart("He"),
			textStart("llo"),
			toolOpen("call_1"),
			toolUpdate("call_1"),
			toolClose("call_1"),
			textEnd("Hello"),
			usage(),
			iterEnd(1),
			done(),
		];
		const result = validateAgentEventStream(trace);
		expect(result.violations).toEqual([]);
		expect(result.terminated).toBe(true);
		expect(result.warts).toEqual([{ id: WART_START_AS_DELTA, count: 3 }]);
	});

	it("accepts an unterminated prefix (mid-stream validation)", () => {
		const result = validateAgentEventStream([
			iterStart(1),
			textStart("Hi"),
		]);
		expect(result.violations).toEqual([]);
		expect(result.terminated).toBe(false);
	});

	it("accepts interleaved parallel tool updates", () => {
		const trace = [
			iterStart(1),
			toolOpen("a"),
			toolOpen("b"),
			toolUpdate("b"),
			toolUpdate("a"),
			toolClose("b"),
			toolClose("a"),
			iterEnd(1),
			done(),
		];
		const result = validateAgentEventStream(trace);
		expect(result.violations).toEqual([]);
	});

	it("accepts notices and usage anywhere before the terminal", () => {
		const trace = [
			notice(),
			usage(),
			iterStart(1),
			notice(),
			textEnd("no deltas streamed"),
			usage(),
			iterEnd(1),
			done(),
		];
		const result = validateAgentEventStream(trace);
		expect(result.violations).toEqual([]);
		// The turn produced final text with no streamed deltas — the
		// dedup-folklore case, counted as W2 not a violation.
		expect(result.warts).toContainEqual({
			id: WART_FINAL_WITHOUT_DELTAS,
			count: 1,
		});
	});
});

describe("stream grammar — violations", () => {
	it("flags any event after the terminal", () => {
		const result = validateAgentEventStream([done(), iterStart(1)]);
		expect(result.violations).toEqual([
			{ code: DOUBLE_TERMINAL, index: 1, eventType: "iteration_start" },
		]);
		expect(DOUBLE_TERMINAL).toBe("double-terminal");
		expect(AFTER_TERMINAL).toBe("after-terminal");
	});

	it("flags overlapping iterations", () => {
		const result = validateAgentEventStream([iterStart(1), iterStart(2)]);
		expect(result.violations).toEqual([
			{ code: ITERATION_OVERLAP, index: 1, eventType: "iteration_start" },
		]);
	});

	it("flags iteration_end without an open iteration", () => {
		const result = validateAgentEventStream([iterEnd(1)]);
		expect(result.violations).toEqual([
			{
				code: ITERATION_END_WITHOUT_START,
				index: 0,
				eventType: "iteration_end",
			},
		]);
	});

	it("flags iteration regression (reuse of an ended iteration number)", () => {
		const result = validateAgentEventStream([
			iterStart(1),
			iterEnd(1),
			iterStart(1),
		]);
		expect(result.violations).toEqual([
			{
				code: ITERATION_REGRESSION,
				index: 2,
				eventType: "iteration_start",
			},
		]);
	});

	it("flags content outside any iteration", () => {
		const result = validateAgentEventStream([textStart("orphan")]);
		expect(result.violations).toEqual([
			{
				code: CONTENT_OUTSIDE_ITERATION,
				index: 0,
				eventType: "content_start",
			},
		]);
	});

	it("flags duplicate tool open and unknown tool updates/ends", () => {
		const dup = validateAgentEventStream([
			iterStart(1),
			toolOpen("a"),
			toolOpen("a"),
		]);
		expect(dup.violations[0]?.code).toBe(TOOL_OPEN_WHILE_OPEN);

		const update = validateAgentEventStream([
			iterStart(1),
			toolUpdate("ghost"),
		]);
		expect(update.violations[0]?.code).toBe(TOOL_UPDATE_WITHOUT_OPEN);

		const end = validateAgentEventStream([iterStart(1), toolClose("ghost")]);
		expect(end.violations[0]?.code).toBe(TOOL_END_WITHOUT_OPEN);
	});

	it("flags a tool block still open at iteration end", () => {
		const result = validateAgentEventStream([
			iterStart(1),
			toolOpen("a"),
			iterEnd(1),
		]);
		expect(result.violations).toEqual([
			{
				code: TOOL_OPEN_AT_ITERATION_END,
				index: 2,
				eventType: "iteration_end",
				detail: "a",
			},
		]);
	});
});

describe("stream grammar — warts", () => {
	it("counts dangling scopes at a terminal as W3, not a violation", () => {
		const result = validateAgentEventStream([
			iterStart(1),
			toolOpen("a"),
			errorEvent(false),
		]);
		expect(result.violations).toEqual([]);
		expect(result.terminated).toBe(true);
		expect(result.warts).toContainEqual({
			id: WART_DANGLING_AT_TERMINAL,
			count: 1,
		});
	});

	it("counts recoverable in-run errors as W4, not a terminal", () => {
		const result = validateAgentEventStream([
			iterStart(1),
			errorEvent(true),
			textStart("still going"),
			textEnd("recovered"),
			iterEnd(1),
			done(),
		]);
		expect(result.violations).toEqual([]);
		expect(result.terminated).toBe(true);
		expect(result.warts).toContainEqual({
			id: WART_TERMINAL_AMBIGUITY,
			count: 1,
		});
	});

	it("counts done(reason:'error') without an error event as W4", () => {
		const result = validateAgentEventStream([
			iterStart(1),
			textEnd("partial"),
			iterEnd(1),
			done("error"),
		]);
		expect(result.violations).toEqual([]);
		expect(result.warts).toContainEqual({
			id: WART_TERMINAL_AMBIGUITY,
			count: 1,
		});
	});

	it("does not treat an explicit error event followed by done as W4", () => {
		const result = validateAgentEventStream([errorEvent(false), done()]);
		expect(result.violations).toEqual([
			{ code: DOUBLE_TERMINAL, index: 1, eventType: "done" },
		]);
	});
});
