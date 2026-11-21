/**
 * Grammar validation of the real producer's output — the Phase 0
 * cross-module guarantee of the agent event stream v2 design
 * (`docs/agent-event-stream-design.md`, Work plan).
 *
 * Every realistic run driven through `RuntimeEventAdapter` must validate
 * with ZERO violations (a violation here is a producer bug or a bug in
 * the tables) and with exactly the expected wart counts. These tests
 * pin the de-facto v1 grammar: when Phase 1 fixes a wart (e.g. renames
 * content_start-as-delta), the corresponding expectation here changes
 * from wart-count to zero.
 */
import type {
	AgentEvent,
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
	AgentToolCallPart,
	AgentUsage,
} from "@cline/shared";
import {
	WART_DANGLING_AT_TERMINAL,
	WART_FINAL_WITHOUT_DELTAS,
	WART_START_AS_DELTA,
	validateAgentEventStream,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { RuntimeEventAdapter } from "./runtime-event-adapter";

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 1,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	};
}

function toolCall(toolCallId: string): AgentToolCallPart {
	return {
		type: "tool-call",
		toolCallId,
		toolName: "read_file",
		input: { path: "/tmp/x" },
	};
}

function usage(overrides: Partial<AgentUsage> = {}): AgentUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
		...overrides,
	};
}

function toolResultMessage(toolCallId: string): AgentMessage {
	return {
		id: "m_tool",
		role: "tool",
		createdAt: 0,
		content: [
			{
				type: "tool-result",
				toolCallId,
				toolName: "read_file",
				output: "ok",
			},
		],
	};
}

/** Drive the real adapter over a runtime event sequence, flattening output. */
function translateRun(
	runtimeEvents: readonly AgentRuntimeEvent[],
): AgentEvent[] {
	const adapter = new RuntimeEventAdapter();
	const events: AgentEvent[] = [];
	for (const runtimeEvent of runtimeEvents) {
		events.push(...adapter.translate(runtimeEvent));
	}
	return events;
}

describe("RuntimeEventAdapter output — v1 grammar validation", () => {
	it("a full streamed run with a tool call validates with zero violations", () => {
		const events = translateRun([
			{ type: "run-started", snapshot: makeSnapshot() },
			{ type: "turn-started", snapshot: makeSnapshot(), iteration: 1 },
			{
				type: "assistant-text-delta",
				snapshot: makeSnapshot(),
				iteration: 1,
				text: "He",
				accumulatedText: "He",
			},
			{
				type: "assistant-text-delta",
				snapshot: makeSnapshot(),
				iteration: 1,
				text: "llo",
				accumulatedText: "Hello",
			},
			{
				type: "tool-started",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: toolCall("call_1"),
			},
			{
				type: "tool-updated",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: toolCall("call_1"),
				update: { progress: 1 },
			},
			{
				type: "tool-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: toolCall("call_1"),
				message: toolResultMessage("call_1"),
			},
			{
				type: "assistant-message",
				snapshot: makeSnapshot(),
				iteration: 1,
				message: {
					id: "m",
					role: "assistant",
					createdAt: 0,
					content: [{ type: "text", text: "Hello" }],
				},
				finishReason: "stop",
			},
			{
				type: "usage-updated",
				snapshot: makeSnapshot(),
				usage: usage({ inputTokens: 10, outputTokens: 5 }),
			},
			{
				type: "turn-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCallCount: 1,
			},
			{
				type: "run-finished",
				snapshot: makeSnapshot(),
				result: {
					agentId: "agent_test",
					runId: "run_test",
					status: "completed",
					iterations: 1,
					outputText: "Hello",
					messages: [],
					usage: usage({ inputTokens: 10, outputTokens: 5 }),
				},
			},
		]);
		const result = validateAgentEventStream(events);
		expect(result.violations).toEqual([]);
		expect(result.terminated).toBe(true);
		// The two text deltas surface as repeated content_start — wart W1.
		expect(result.warts).toEqual([{ id: WART_START_AS_DELTA, count: 2 }]);
	});

	it("a failure mid-tool leaves scopes dangling (W3, not a violation)", () => {
		const events = translateRun([
			{ type: "turn-started", snapshot: makeSnapshot(), iteration: 1 },
			{
				type: "tool-started",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: toolCall("call_1"),
			},
			{
				type: "run-failed",
				snapshot: makeSnapshot(),
				error: new Error("provider exploded"),
			},
		]);
		const result = validateAgentEventStream(events);
		expect(result.violations).toEqual([]);
		expect(result.terminated).toBe(true);
		expect(result.warts).toEqual([
			{ id: WART_DANGLING_AT_TERMINAL, count: 1 },
		]);
	});

	it("a non-streaming turn produces content_end without deltas (W2)", () => {
		const events = translateRun([
			{ type: "turn-started", snapshot: makeSnapshot(), iteration: 1 },
			{
				type: "assistant-message",
				snapshot: makeSnapshot(),
				iteration: 1,
				message: {
					id: "m",
					role: "assistant",
					createdAt: 0,
					content: [{ type: "text", text: "done" }],
				},
				finishReason: "stop",
			},
			{
				type: "turn-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCallCount: 0,
			},
			{
				type: "run-finished",
				snapshot: makeSnapshot(),
				result: {
					agentId: "agent_test",
					runId: "run_test",
					status: "completed",
					iterations: 1,
					outputText: "done",
					messages: [],
					usage: usage(),
				},
			},
		]);
		const result = validateAgentEventStream(events);
		expect(result.violations).toEqual([]);
		expect(result.warts).toEqual([
			{ id: WART_FINAL_WITHOUT_DELTAS, count: 1 },
		]);
	});

	it("a multi-iteration run with increasing iteration numbers validates", () => {
		const events = translateRun([
			{ type: "turn-started", snapshot: makeSnapshot(), iteration: 1 },
			{
				type: "tool-started",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: toolCall("call_1"),
			},
			{
				type: "tool-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: toolCall("call_1"),
				message: toolResultMessage("call_1"),
			},
			{
				type: "turn-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCallCount: 1,
			},
			{ type: "turn-started", snapshot: makeSnapshot(), iteration: 2 },
			{
				type: "assistant-message",
				snapshot: makeSnapshot(),
				iteration: 2,
				message: {
					id: "m2",
					role: "assistant",
					createdAt: 0,
					content: [{ type: "text", text: "done" }],
				},
				finishReason: "stop",
			},
			{
				type: "turn-finished",
				snapshot: makeSnapshot(),
				iteration: 2,
				toolCallCount: 0,
			},
			{
				type: "run-finished",
				snapshot: makeSnapshot(),
				result: {
					agentId: "agent_test",
					runId: "run_test",
					status: "completed",
					iterations: 2,
					outputText: "done",
					messages: [],
					usage: usage(),
				},
			},
		]);
		const result = validateAgentEventStream(events);
		expect(result.violations).toEqual([]);
		expect(result.terminated).toBe(true);
	});
});
