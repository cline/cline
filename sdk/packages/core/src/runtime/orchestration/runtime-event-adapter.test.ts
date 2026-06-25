/**
 * Unit tests for `RuntimeEventAdapter` and `toLegacyAgentEvent`.
 *
 * Covers every one of the 13 `AgentRuntimeEvent` variants enumerated
 * in `@cline/shared/src/agent.ts:390-468`. For each variant the
 * test asserts the mapping described in PLAN.md §3.3.2 (with the
 * text/reasoning-delta correction documented at the top of
 * `runtime-event-adapter.ts`).
 *
 * @see PLAN.md §3.3.2 — variant-by-variant OLD → NEW mapping.
 * @see packages/core/src/runtime/runtime-event-adapter.ts
 *
 * Landed with PLAN.md Step 8a.
 */

import type {
	AgentMessage,
	AgentRunResult,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
	AgentToolCallPart,
	AgentUsage,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	RuntimeEventAdapter,
	toLegacyAgentEvent,
} from "./runtime-event-adapter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(
	overrides: Partial<AgentRuntimeStateSnapshot> = {},
): AgentRuntimeStateSnapshot {
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
		...overrides,
	};
}

function makeMessage(
	overrides: Partial<AgentMessage> = {},
	content: AgentMessage["content"] = [],
): AgentMessage {
	return {
		id: "msg_test",
		role: "assistant",
		content,
		createdAt: 1_000_000,
		...overrides,
	};
}

function makeToolCall(
	overrides: Partial<AgentToolCallPart> = {},
): AgentToolCallPart {
	return {
		type: "tool-call",
		toolCallId: "call_1",
		toolName: "read_file",
		input: { path: "/tmp/x" },
		...overrides,
	};
}

function makeUsage(overrides: Partial<AgentUsage> = {}): AgentUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
		...overrides,
	};
}

function makeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "completed",
		iterations: 1,
		outputText: "done",
		messages: [],
		usage: makeUsage(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Suppressed events
// ---------------------------------------------------------------------------

describe("RuntimeEventAdapter — suppressed events", () => {
	let adapter: RuntimeEventAdapter;
	beforeEach(() => {
		adapter = new RuntimeEventAdapter();
	});

	it("suppresses run-started (§3.3.2 row 1)", () => {
		expect(
			adapter.translate({ type: "run-started", snapshot: makeSnapshot() }),
		).toEqual([]);
	});

	it("suppresses message-added (§3.3.2 final note)", () => {
		expect(
			adapter.translate({
				type: "message-added",
				snapshot: makeSnapshot(),
				message: makeMessage(),
			}),
		).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Iteration lifecycle
// ---------------------------------------------------------------------------

describe("RuntimeEventAdapter — iteration lifecycle", () => {
	let adapter: RuntimeEventAdapter;
	beforeEach(() => {
		adapter = new RuntimeEventAdapter();
	});

	it("maps turn-started → iteration_start { iteration }", () => {
		const out = adapter.translate({
			type: "turn-started",
			snapshot: makeSnapshot({ iteration: 3 }),
			iteration: 3,
		});
		expect(out).toEqual([{ type: "iteration_start", iteration: 3 }]);
	});

	it("maps turn-finished → iteration_end with hadToolCalls=true when tools fired", () => {
		const out = adapter.translate({
			type: "turn-finished",
			snapshot: makeSnapshot({ iteration: 2 }),
			iteration: 2,
			toolCallCount: 4,
		});
		expect(out).toEqual([
			{
				type: "iteration_end",
				iteration: 2,
				hadToolCalls: true,
				toolCallCount: 4,
			},
		]);
	});

	it("maps turn-finished with zero tool calls → hadToolCalls:false", () => {
		const out = adapter.translate({
			type: "turn-finished",
			snapshot: makeSnapshot({ iteration: 1 }),
			iteration: 1,
			toolCallCount: 0,
		});
		expect(out).toEqual([
			{
				type: "iteration_end",
				iteration: 1,
				hadToolCalls: false,
				toolCallCount: 0,
			},
		]);
	});
});

// ---------------------------------------------------------------------------
// Streaming content deltas
// ---------------------------------------------------------------------------
//
// PLAN §3.3.2 suggested "first delta → content_start, subsequent →
// content_update". The legacy-emitter shape makes that impossible —
// AgentContentUpdateEvent.contentType is strictly "tool"
// (shared/agents/types.ts:87). The adapter preserves the legacy
// per-delta content_start behavior
// (turn-processor.ts:82-87,113-118).

describe("RuntimeEventAdapter — streaming content deltas", () => {
	let adapter: RuntimeEventAdapter;
	beforeEach(() => {
		adapter = new RuntimeEventAdapter();
	});

	it("maps every assistant-text-delta → content_start(text)", () => {
		const first = adapter.translate({
			type: "assistant-text-delta",
			snapshot: makeSnapshot(),
			iteration: 1,
			text: "He",
			accumulatedText: "He",
		});
		const second = adapter.translate({
			type: "assistant-text-delta",
			snapshot: makeSnapshot(),
			iteration: 1,
			text: "llo",
			accumulatedText: "Hello",
		});
		expect(first).toEqual([
			{
				type: "content_start",
				contentType: "text",
				text: "He",
				accumulated: "He",
			},
		]);
		expect(second).toEqual([
			{
				type: "content_start",
				contentType: "text",
				text: "llo",
				accumulated: "Hello",
			},
		]);
	});

	it("maps assistant-reasoning-delta → content_start(reasoning) with redacted:true", () => {
		const out = adapter.translate({
			type: "assistant-reasoning-delta",
			snapshot: makeSnapshot(),
			iteration: 1,
			text: "thinking...",
			accumulatedText: "thinking...",
			redacted: true,
		});
		expect(out).toEqual([
			{
				type: "content_start",
				contentType: "reasoning",
				reasoning: "thinking...",
				redacted: true,
			},
		]);
	});

	it("defaults redacted to false when missing", () => {
		const out = adapter.translate({
			type: "assistant-reasoning-delta",
			snapshot: makeSnapshot(),
			iteration: 1,
			text: "thinking",
			accumulatedText: "thinking",
		});
		expect(out[0]).toMatchObject({
			type: "content_start",
			contentType: "reasoning",
			redacted: false,
		});
	});
});

// ---------------------------------------------------------------------------
// Assistant-message → content_end synthesis
// ---------------------------------------------------------------------------

describe("RuntimeEventAdapter — assistant-message → content_end", () => {
	let adapter: RuntimeEventAdapter;
	beforeEach(() => {
		adapter = new RuntimeEventAdapter();
	});

	it("fires content_end(text) when the message has text parts", () => {
		const out = adapter.translate({
			type: "assistant-message",
			snapshot: makeSnapshot(),
			iteration: 1,
			message: makeMessage({}, [{ type: "text", text: "hi there" }]),
			finishReason: "stop",
		});
		expect(out).toEqual([
			{ type: "content_end", contentType: "text", text: "hi there" },
		]);
	});

	it("fires content_end(reasoning) when the message has reasoning parts", () => {
		const out = adapter.translate({
			type: "assistant-message",
			snapshot: makeSnapshot(),
			iteration: 1,
			message: makeMessage({}, [{ type: "reasoning", text: "let me think" }]),
			finishReason: "stop",
		});
		expect(out).toEqual([
			{
				type: "content_end",
				contentType: "reasoning",
				reasoning: "let me think",
			},
		]);
	});

	it("fires BOTH content_end events when the message has text AND reasoning", () => {
		const out = adapter.translate({
			type: "assistant-message",
			snapshot: makeSnapshot(),
			iteration: 1,
			message: makeMessage({}, [
				{ type: "reasoning", text: "pondering" },
				{ type: "text", text: "answer" },
			]),
			finishReason: "stop",
		});
		expect(out).toHaveLength(2);
		expect(out).toContainEqual({
			type: "content_end",
			contentType: "text",
			text: "answer",
		});
		expect(out).toContainEqual({
			type: "content_end",
			contentType: "reasoning",
			reasoning: "pondering",
		});
	});

	it("fires NO content_end events when the message has no text/reasoning", () => {
		const out = adapter.translate({
			type: "assistant-message",
			snapshot: makeSnapshot(),
			iteration: 1,
			message: makeMessage({}, [
				{
					type: "tool-call",
					toolCallId: "x",
					toolName: "foo",
					input: {},
				},
			]),
			finishReason: "tool-calls",
		});
		expect(out).toEqual([]);
	});

	it("concatenates multiple text parts into one content_end.text", () => {
		const out = adapter.translate({
			type: "assistant-message",
			snapshot: makeSnapshot(),
			iteration: 1,
			message: makeMessage({}, [
				{ type: "text", text: "Hel" },
				{ type: "text", text: "lo" },
			]),
			finishReason: "stop",
		});
		expect(out[0]).toEqual({
			type: "content_end",
			contentType: "text",
			text: "Hello",
		});
	});
});

// ---------------------------------------------------------------------------
// Tool lifecycle + durationMs bookkeeping
// ---------------------------------------------------------------------------

describe("RuntimeEventAdapter — tool lifecycle", () => {
	let adapter: RuntimeEventAdapter;
	beforeEach(() => {
		adapter = new RuntimeEventAdapter();
	});

	it("maps tool-started → content_start(tool) with toolName/toolCallId/input", () => {
		const toolCall = makeToolCall({
			toolCallId: "call_abc",
			toolName: "read_file",
			input: { path: "/tmp/a" },
		});
		const out = adapter.translate({
			type: "tool-started",
			snapshot: makeSnapshot(),
			iteration: 1,
			toolCall,
		});
		expect(out).toEqual([
			{
				type: "content_start",
				contentType: "tool",
				toolName: "read_file",
				toolCallId: "call_abc",
				input: { path: "/tmp/a" },
			},
		]);
	});

	it("maps tool-updated → content_update(tool) with update", () => {
		const toolCall = makeToolCall({ toolCallId: "call_abc" });
		const out = adapter.translate({
			type: "tool-updated",
			snapshot: makeSnapshot(),
			iteration: 1,
			toolCall,
			update: { progress: 0.5 },
		});
		expect(out).toEqual([
			{
				type: "content_update",
				contentType: "tool",
				toolName: "read_file",
				toolCallId: "call_abc",
				update: { progress: 0.5 },
			},
		]);
	});

	it("maps tool-finished with tracked timing → content_end(tool) with durationMs", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date(1_700_000_000_000));
			const toolCall = makeToolCall({ toolCallId: "call_42" });
			adapter.translate({
				type: "tool-started",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall,
			});
			vi.advanceTimersByTime(250);
			const out = adapter.translate({
				type: "tool-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall,
				message: {
					id: "msg_tool",
					role: "tool",
					createdAt: 1_700_000_000_250,
					content: [
						{
							type: "tool-result",
							toolCallId: "call_42",
							toolName: "read_file",
							output: "file contents here",
						},
					],
				},
			});
			expect(out).toEqual([
				{
					type: "content_end",
					contentType: "tool",
					toolName: "read_file",
					toolCallId: "call_42",
					output: "file contents here",
					error: undefined,
					durationMs: 250,
				},
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("populates error on tool-finished when the result is marked isError", () => {
		const toolCall = makeToolCall({ toolCallId: "call_err" });
		adapter.translate({
			type: "tool-started",
			snapshot: makeSnapshot(),
			iteration: 1,
			toolCall,
		});
		const out = adapter.translate({
			type: "tool-finished",
			snapshot: makeSnapshot(),
			iteration: 1,
			toolCall,
			message: {
				id: "msg_err",
				role: "tool",
				createdAt: 0,
				content: [
					{
						type: "tool-result",
						toolCallId: "call_err",
						toolName: "read_file",
						output: "file not found",
						isError: true,
					},
				],
			},
		});
		expect(out[0]).toMatchObject({
			type: "content_end",
			contentType: "tool",
			error: "file not found",
		});
	});

	it("reports durationMs:undefined when tool-started was never seen", () => {
		const toolCall = makeToolCall({ toolCallId: "call_orphan" });
		const out = adapter.translate({
			type: "tool-finished",
			snapshot: makeSnapshot(),
			iteration: 1,
			toolCall,
			message: {
				id: "m",
				role: "tool",
				createdAt: 0,
				content: [
					{
						type: "tool-result",
						toolCallId: "call_orphan",
						toolName: "read_file",
						output: "ok",
					},
				],
			},
		});
		expect(out[0]).toMatchObject({ durationMs: undefined });
	});
});

// ---------------------------------------------------------------------------
// Usage rolling totals
// ---------------------------------------------------------------------------

describe("RuntimeEventAdapter — usage rolling totals", () => {
	let adapter: RuntimeEventAdapter;
	beforeEach(() => {
		adapter = new RuntimeEventAdapter();
	});

	it("first usage-updated: delta == accumulated (prior snapshot is zero)", () => {
		const out = adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({
				inputTokens: 100,
				outputTokens: 40,
				cacheReadTokens: 5,
				totalCost: 0.01,
			}),
		});
		expect(out[0]).toEqual({
			type: "usage",
			inputTokens: 100,
			outputTokens: 40,
			cacheReadTokens: 5,
			cacheWriteTokens: undefined,
			cost: 0.01,
			totalInputTokens: 100,
			totalOutputTokens: 40,
			totalCacheReadTokens: 5,
			totalCacheWriteTokens: undefined,
			totalCost: 0.01,
		});
	});

	it("second usage-updated: delta = (next - prior), totals are accumulated", () => {
		adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({
				inputTokens: 100,
				outputTokens: 40,
				totalCost: 0.01,
			}),
		});
		const out = adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({
				inputTokens: 150,
				outputTokens: 60,
				totalCost: 0.03,
			}),
		});
		expect(out[0]).toMatchObject({
			inputTokens: 50,
			outputTokens: 20,
			totalInputTokens: 150,
			totalOutputTokens: 60,
			totalCost: 0.03,
		});
		// Floating-point-safe: 0.03 - 0.01 ≠ exactly 0.02 in IEEE-754.
		expect((out[0] as { cost?: number }).cost).toBeCloseTo(0.02, 10);
	});

	it("omits cost when the totalCost delta is zero", () => {
		adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({ inputTokens: 10 }),
		});
		const out = adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({ inputTokens: 20 }),
		});
		expect(out[0]).toMatchObject({ cost: undefined });
	});

	it("clamps negative deltas to zero (defensive)", () => {
		adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({ inputTokens: 100 }),
		});
		const out = adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({ inputTokens: 50 }),
		});
		expect(out[0]).toMatchObject({ inputTokens: 0 });
	});

	it("resets rolling totals via reset()", () => {
		adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({ inputTokens: 100, outputTokens: 50 }),
		});
		adapter.reset();
		const out = adapter.translate({
			type: "usage-updated",
			snapshot: makeSnapshot(),
			usage: makeUsage({ inputTokens: 10, outputTokens: 5 }),
		});
		expect(out[0]).toMatchObject({
			inputTokens: 10,
			outputTokens: 5,
			totalInputTokens: 10,
			totalOutputTokens: 5,
		});
	});
});

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

describe("RuntimeEventAdapter — run lifecycle", () => {
	let adapter: RuntimeEventAdapter;
	beforeEach(() => {
		adapter = new RuntimeEventAdapter();
	});

	it("maps run-finished { status:completed } → done { reason:completed }", () => {
		const out = adapter.translate({
			type: "run-finished",
			snapshot: makeSnapshot(),
			result: makeResult({
				status: "completed",
				outputText: "done",
				iterations: 3,
				usage: makeUsage({
					inputTokens: 100,
					outputTokens: 50,
					totalCost: 0.015,
				}),
			}),
		});
		expect(out[0]).toEqual({
			type: "done",
			reason: "completed",
			text: "done",
			iterations: 3,
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: undefined,
				cacheWriteTokens: undefined,
				totalCost: 0.015,
			},
		});
	});

	it("maps run-finished { status:aborted } → done { reason:aborted }", () => {
		const out = adapter.translate({
			type: "run-finished",
			snapshot: makeSnapshot(),
			result: makeResult({ status: "aborted", outputText: "" }),
		});
		expect(out[0]).toMatchObject({ type: "done", reason: "aborted" });
	});

	it("maps run-finished { status:failed } → done { reason:error }", () => {
		const out = adapter.translate({
			type: "run-finished",
			snapshot: makeSnapshot(),
			result: makeResult({ status: "failed" }),
		});
		expect(out[0]).toMatchObject({ type: "done", reason: "error" });
	});

	it("maps run-failed → error { recoverable:false, iteration }", () => {
		const err = new Error("boom");
		const out = adapter.translate({
			type: "run-failed",
			snapshot: makeSnapshot({ iteration: 4 }),
			error: err,
		});
		expect(out[0]).toEqual({
			type: "error",
			error: err,
			recoverable: false,
			iteration: 4,
		});
	});
});

// ---------------------------------------------------------------------------
// Stateless helper
// ---------------------------------------------------------------------------

describe("toLegacyAgentEvent — stateless helper", () => {
	it("returns undefined for suppressed events", () => {
		expect(
			toLegacyAgentEvent({ type: "run-started", snapshot: makeSnapshot() }),
		).toBeUndefined();
		expect(
			toLegacyAgentEvent({
				type: "message-added",
				snapshot: makeSnapshot(),
				message: makeMessage(),
			}),
		).toBeUndefined();
	});

	it("returns the first legacy event when the mapping yields multiple", () => {
		const result = toLegacyAgentEvent({
			type: "assistant-message",
			snapshot: makeSnapshot(),
			iteration: 1,
			message: makeMessage({}, [
				{ type: "reasoning", text: "r" },
				{ type: "text", text: "t" },
			]),
			finishReason: "stop",
		});
		expect(result?.type).toBe("content_end");
	});

	it("returns undefined when the mapping yields zero events", () => {
		const result = toLegacyAgentEvent({
			type: "assistant-message",
			snapshot: makeSnapshot(),
			iteration: 1,
			message: makeMessage({}, []),
			finishReason: "stop",
		});
		expect(result).toBeUndefined();
	});

	it("maps a single run-finished one-shot correctly", () => {
		const event = toLegacyAgentEvent({
			type: "run-finished",
			snapshot: makeSnapshot(),
			result: makeResult({
				status: "completed",
				outputText: "ok",
				iterations: 1,
			}),
		});
		expect(event).toMatchObject({
			type: "done",
			reason: "completed",
			text: "ok",
			iterations: 1,
		});
	});

	it("reports durationMs=undefined on tool-finished (one-shot has no timing)", () => {
		const toolCall = makeToolCall({ toolCallId: "c1" });
		const event = toLegacyAgentEvent({
			type: "tool-finished",
			snapshot: makeSnapshot(),
			iteration: 1,
			toolCall,
			message: {
				id: "m",
				role: "tool",
				createdAt: 0,
				content: [
					{
						type: "tool-result",
						toolCallId: "c1",
						toolName: "read_file",
						output: "ok",
					},
				],
			},
		});
		expect(event).toMatchObject({ durationMs: undefined });
	});
});

// ---------------------------------------------------------------------------
// Exhaustiveness — all 13 AgentRuntimeEvent variants
// ---------------------------------------------------------------------------

describe("RuntimeEventAdapter — exhaustiveness", () => {
	it("handles every one of the 13 AgentRuntimeEvent variants without throwing", () => {
		const adapter = new RuntimeEventAdapter();
		const variants: AgentRuntimeEvent[] = [
			{ type: "run-started", snapshot: makeSnapshot() },
			{
				type: "message-added",
				snapshot: makeSnapshot(),
				message: makeMessage(),
			},
			{ type: "turn-started", snapshot: makeSnapshot(), iteration: 1 },
			{
				type: "assistant-text-delta",
				snapshot: makeSnapshot(),
				iteration: 1,
				text: "a",
				accumulatedText: "a",
			},
			{
				type: "assistant-reasoning-delta",
				snapshot: makeSnapshot(),
				iteration: 1,
				text: "r",
				accumulatedText: "r",
			},
			{
				type: "assistant-message",
				snapshot: makeSnapshot(),
				iteration: 1,
				message: makeMessage({}, [{ type: "text", text: "hi" }]),
				finishReason: "stop",
			},
			{
				type: "tool-started",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: makeToolCall(),
			},
			{
				type: "tool-updated",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: makeToolCall(),
				update: {},
			},
			{
				type: "tool-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCall: makeToolCall(),
				message: {
					id: "m",
					role: "tool",
					createdAt: 0,
					content: [
						{
							type: "tool-result",
							toolCallId: "call_1",
							toolName: "read_file",
							output: "",
						},
					],
				},
			},
			{
				type: "usage-updated",
				snapshot: makeSnapshot(),
				usage: makeUsage(),
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
				result: makeResult(),
			},
			{
				type: "run-failed",
				snapshot: makeSnapshot(),
				error: new Error("boom"),
			},
		];
		expect(variants).toHaveLength(13);
		for (const event of variants) {
			expect(() => adapter.translate(event)).not.toThrow();
		}
	});
});
