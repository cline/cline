/**
 * Phase 1 dual-emit guarantee: `RuntimeFrameAdapter`'s v1 output is
 * byte-identical to the plain `RuntimeEventAdapter`, and its frame
 * output is legal per `validateFrameStream`. This is the "no existing
 * consumer changes" proof of the migration.
 */
import type {
	AgentEvent,
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
	AgentToolCallPart,
	AgentUsage,
} from "@cline/shared";
import { validateFrameStream } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { RuntimeEventAdapter } from "./runtime-event-adapter";
import { RuntimeFrameAdapter } from "./runtime-frame-adapter";

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

const RUN: readonly AgentRuntimeEvent[] = [
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
		update: { p: 1 },
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
];

describe("RuntimeFrameAdapter — dual-emit", () => {
	it("v1 events are identical to the plain adapter; frames are legal", () => {
		const plain = new RuntimeEventAdapter();
		const dual = new RuntimeFrameAdapter();

		// durationMs is wall-clock per adapter instance (tool-started to
		// tool-finished); normalize it so the identity check compares
		// structure, not sub-millisecond scheduling.
		const normalize = (event: AgentEvent): Record<string, unknown> => {
			if (event.type === "content_end" && event.contentType === "tool") {
				return { ...event, durationMs: "normalized" };
			}
			return { ...event };
		};

		const dualEvents = [];
		const plainEvents = [];
		const frames = [];
		for (const runtimeEvent of RUN) {
			const { events, frames: f } = dual.translateWithFrames(
				runtimeEvent,
			);
			dualEvents.push(...events);
			frames.push(...f);
			plainEvents.push(...plain.translate(runtimeEvent));
		}
		expect(dualEvents.map(normalize)).toEqual(
			plainEvents.map(normalize),
		);
		// The normalized field is still a real measured duration.
		const toolEnd = dualEvents.find(
			(event): event is Extract<AgentEvent, { type: "content_end" }> =>
				event.type === "content_end" && event.contentType === "tool",
		);
		expect(typeof toolEnd?.durationMs).toBe("number");

		const validation = validateFrameStream(frames);
		expect(validation.violations).toEqual([]);
		expect(validation.openBlocks).toEqual([]);
		expect(validation.openTurnId).toBeUndefined();
	});

	it("reset() fences open scopes with interrupted and the next run opens a new turn with continued seq", () => {
		const dual = new RuntimeFrameAdapter();
		const allFrames = [];

		// Open a turn and a tool, then fence the run mid-flight.
		const first = dual.translateWithFrames({
			type: "turn-started",
			snapshot: makeSnapshot(),
			iteration: 1,
		});
		allFrames.push(...first.frames);
		const second = dual.translateWithFrames({
			type: "tool-started",
			snapshot: makeSnapshot(),
			iteration: 1,
			toolCall: toolCall("call_1"),
		});
		allFrames.push(...second.frames);

		const fenced = dual.reset();
		const fencedCloses = fenced.filter((frame) => frame.kind === "close");
		expect(fencedCloses).toHaveLength(2); // tool block, then turn
		expect(
			fencedCloses.every((close) => close.outcome.kind === "interrupted"),
		).toBe(true);
		allFrames.push(...fenced);

		// The next run's events open a fresh turn; no old-turn frames leak.
		const next = dual.translateWithFrames({
			type: "turn-started",
			snapshot: makeSnapshot(),
			iteration: 1,
		});
		const openTurns = next.frames.filter(
			(frame) => frame.kind === "open" && frame.openKind === "turn",
		);
		expect(openTurns).toHaveLength(1);
		allFrames.push(...next.frames);

		const validation = validateFrameStream(allFrames);
		expect(validation.violations).toEqual([]);
		expect(validation.openBlocks).toEqual([]);
		// The new run is legitimately mid-flight: turn-2 is open, and
		// turn-1's tool closed during the fence (zero violations proves
		// the fence close matched its open).
		expect(validation.openTurnId).toBe("turn-2");
	});
});
