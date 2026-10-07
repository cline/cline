import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	FIXTURE_SESSION_ID,
	fixtureHookEntries,
	fixtureMessages,
} from "./bundle.fixtures";
import {
	hookEntryBelongsToSessionTree,
	isRootAgentHookEntry,
	toSessionReplayHookEvents,
} from "./bundle-hook-events";
import {
	buildSessionReplayIterations,
	describeSessionReplayEvent,
	selectSessionReplayIterations,
} from "./bundle-iterations";
import { createSessionReplayRedactor } from "./bundle-redaction";
import type { SessionReplayEvent } from "./bundle-schema";
import type { SessionRecordedModelCall } from "./recording-schema";

function fixtureEvents() {
	return toSessionReplayHookEvents({
		sessionId: FIXTURE_SESSION_ID,
		entries: fixtureHookEntries().filter(
			(entry) =>
				hookEntryBelongsToSessionTree(entry, FIXTURE_SESSION_ID) &&
				isRootAgentHookEntry(entry),
		),
		redactor: createSessionReplayRedactor({ enabled: false }),
		file: "events.jsonl",
	});
}

describe("buildSessionReplayIterations", () => {
	it("projects one iteration per model call with prompt, tools, usage and timing", () => {
		const iterations = buildSessionReplayIterations({
			transcript: {
				sessionId: FIXTURE_SESSION_ID,
				messages: fixtureMessages(),
			},
			events: fixtureEvents(),
		});
		expect(iterations).toHaveLength(2);
		const [first, second] = iterations;

		expect(first).toMatchObject({
			index: 1,
			turn: 1,
			sessionId: FIXTURE_SESSION_ID,
			prompt: { text: "List the files", ts: "2026-01-01T00:00:00.000Z" },
			assistant: {
				text: "Running ls.",
				reasoning: "I should run ls.",
				messageId: "m2",
			},
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				cost: 0.001,
			},
			model: { id: "fake-model", provider: "openai-compatible" },
			messageRange: { start: 0, end: 3 },
			timing: {
				startedAt: "2026-01-01T00:00:00.000Z",
				endedAt: "2026-01-01T00:00:01.500Z",
				toolMs: 250,
			},
		});
		expect(first?.toolCalls).toEqual([
			{
				id: "call_1",
				name: "run_commands",
				input: { commands: ["ls"] },
				execution: "client",
				result: {
					text: "a.txt\nb.txt",
					isError: false,
					content: "a.txt\nb.txt",
				},
				startedAt: "2026-01-01T00:00:01.150Z",
				endedAt: "2026-01-01T00:00:01.400Z",
				durationMs: 250,
			},
		]);
		expect(first?.events.map((event) => event.name)).toEqual([
			"tool_call",
			"tool_result",
		]);

		expect(second).toMatchObject({
			index: 2,
			turn: 1,
			assistant: { text: "There are two files.", reasoning: "" },
			toolCalls: [],
			messageRange: { start: 3, end: 4 },
			timing: {
				startedAt: "2026-01-01T00:00:03.000Z",
				endedAt: "2026-01-01T00:00:03.100Z",
				sincePreviousMs: 1_500,
			},
		});
		expect(second?.prompt).toBeUndefined();
		expect(second?.events.map((event) => event.name)).toEqual(["agent_end"]);
	});

	it("starts a new turn for each user prompt and keeps unanswered prompts", () => {
		const messages: MessageWithMetadata[] = [
			...fixtureMessages(),
			{ role: "user", content: "And hidden files?" },
		];
		const iterations = buildSessionReplayIterations({
			transcript: { sessionId: FIXTURE_SESSION_ID, messages },
		});
		expect(iterations.map((iteration) => iteration.turn)).toEqual([1, 1, 2]);
		expect(iterations[2]).toMatchObject({
			index: 3,
			prompt: { text: "And hidden files?" },
			toolCalls: [],
		});
		expect(iterations[2]?.assistant).toBeUndefined();
	});

	it("separates runtime-injected user messages from prompts", () => {
		const [first, ...rest] = fixtureMessages();
		const messages: MessageWithMetadata[] = [
			first as MessageWithMetadata,
			{
				role: "user",
				content: "[SYSTEM] This run is not complete until you call submit.",
				metadata: { userRunSpan: 0 },
			},
			...rest,
		];
		const [iteration] = buildSessionReplayIterations({
			transcript: { sessionId: FIXTURE_SESSION_ID, messages },
		});
		expect(iteration?.prompt?.text).toBe("List the files");
		expect(iteration?.injected).toEqual([
			{ text: "[SYSTEM] This run is not complete until you call submit." },
		]);
	});

	it("does not start iterations for display-only assistant messages", () => {
		const messages: MessageWithMetadata[] = [
			...fixtureMessages(),
			{
				role: "assistant",
				content: "Context compacted.",
				metadata: { displayOnly: true, displayRole: "status" },
			},
		];
		const iterations = buildSessionReplayIterations({
			transcript: { sessionId: FIXTURE_SESSION_ID, messages },
		});
		expect(iterations).toHaveLength(2);
		expect(iterations[1]?.messageRange).toEqual({ start: 3, end: 5 });
	});
});

function recordedCall(
	callIndex: number,
	seq: number,
	response: Partial<SessionRecordedModelCall["response"]> = {},
): SessionRecordedModelCall {
	return {
		callIndex,
		seq,
		sessionId: FIXTURE_SESSION_ID,
		agentId: "agent_1",
		runId: "run_1",
		iteration: callIndex + 1,
		attempt: 0,
		startedAt: "2026-01-01T00:00:00.000Z",
		finishedAt: "2026-01-01T00:00:00.500Z",
		durationMs: 500,
		compaction: null,
		request: {
			matchKey: "a".repeat(64),
			systemPromptSha256: null,
			toolsSha256: "b".repeat(64),
			modelToolsSha256: null,
			messageSha256s: ["c".repeat(64)],
			options: null,
			provider: {},
		},
		response: {
			outcome: "completed",
			finishReason: "stop",
			requestId: null,
			error: null,
			messageId: null,
			toolCallIds: [],
			usage: { inputTokens: 10, outputTokens: 2 },
			events: [],
			...response,
		},
	};
}

function decision(
	seq: number,
	name: string,
	payload: Record<string, unknown> = {},
): SessionReplayEvent {
	return {
		index: seq,
		seq,
		// Same timestamp for all: placement must come from seq.
		ts: "2026-01-01T00:00:00.000Z",
		kind: "decision",
		name,
		sessionId: FIXTURE_SESSION_ID,
		agentId: "agent_1",
		payload,
	};
}

describe("buildSessionReplayIterations with a recording", () => {
	const iterations = buildSessionReplayIterations({
		transcript: { sessionId: FIXTURE_SESSION_ID, messages: fixtureMessages() },
		events: [
			decision(0, "prompt_delivered", {
				delivery: "immediate",
				source: "start",
			}),
			decision(5, "prompt_enqueued", { delivery: "steer", prompt: "also" }),
			decision(10, "abort_requested", { source: "abort", reason: "user" }),
		],
		requests: [
			recordedCall(1, 3, { messageId: "m2", finishReason: "tool-calls" }),
			recordedCall(0, 2, { outcome: "error", error: "overloaded" }),
			recordedCall(2, 8, { messageId: "m4" }),
			recordedCall(3, 12, { outcome: "interrupted" }),
		],
	});

	it("attaches each linked call with the failed attempts before it", () => {
		expect(
			iterations.map((iteration) =>
				iteration.modelCalls?.map(
					(call) => `${call.callIndex}:${call.outcome}`,
				),
			),
		).toEqual([
			["0:error", "1:completed"],
			["2:completed", "3:interrupted"],
		]);
		expect(iterations[0]?.modelCalls?.[0]).toMatchObject({
			error: "overloaded",
			usage: { inputTokens: 10, outputTokens: 2 },
			messageCount: 1,
		});
	});

	it("places sequenced events by seq rather than timestamp", () => {
		expect(
			iterations.map((iteration) =>
				iteration.events.map((event) => event.detail),
			),
		).toEqual([
			["immediate prompt delivered (start)"],
			['steer prompt queued: "also"', "abort requested by abort: user"],
		]);
		expect(iterations[1]?.events[0]).toMatchObject({ seq: 5 });
	});

	it("leaves unrecorded sessions without model calls", () => {
		const plain = buildSessionReplayIterations({
			transcript: {
				sessionId: FIXTURE_SESSION_ID,
				messages: fixtureMessages(),
			},
		});
		expect(plain.every((iteration) => !iteration.modelCalls)).toBe(true);
	});
});

describe("describeSessionReplayEvent", () => {
	const describeDecision = (name: string, payload: Record<string, unknown>) =>
		describeSessionReplayEvent({ kind: "decision", name, payload });

	it("describes decisions", () => {
		expect(
			describeDecision("approval_resolved", {
				toolName: "run_commands",
				approved: false,
				reason: "not now",
				decidedBy: { kind: "client", detail: "vscode" },
				waitMs: 1234.4,
			}),
		).toBe("denied run_commands by client (vscode) after 1234ms: not now");
		expect(
			describeDecision("prompt_enqueued", {
				delivery: "queue",
				merged: true,
				aborting: true,
				prompt: `${"x".repeat(80)}\nsecond line`,
			}),
		).toBe(
			`queue prompt queued (merged, while aborting): "${"x".repeat(59)}…"`,
		);
		expect(
			describeDecision("prompt_delivered", {
				delivery: "queue",
				requestedDelivery: "steer",
			}),
		).toBe("queue prompt delivered (requested steer)");
		expect(
			describeDecision("mode_switched", {
				from: "act",
				to: "plan",
				source: "turn",
			}),
		).toBe("mode act → plan (turn)");
		expect(
			describeDecision("prompt_queue_discarded", { promptIds: ["a", "b"] }),
		).toBe("2 queued prompts discarded");
		expect(
			describeDecision("mistake_limit_resolved", {
				consecutiveMistakes: 3,
				maxConsecutiveMistakes: 3,
				action: "stop",
			}),
		).toBe("mistake limit 3/3: stop");
		expect(describeDecision("something_new", {})).toBeUndefined();
	});

	it("describes runtime events and ignores hook events", () => {
		expect(
			describeSessionReplayEvent({
				kind: "runtime",
				name: "model_finished",
				refs: { modelCallIndex: 4 },
				payload: { outcome: "completed", finishReason: "stop", durationMs: 12 },
			}),
		).toBe("model call 4 completed (stop) in 12ms");
		expect(
			describeSessionReplayEvent({
				kind: "runtime",
				name: "tool_finished",
				payload: { toolName: "editor", isError: true },
			}),
		).toBe("editor failed");
		expect(
			describeSessionReplayEvent({
				kind: "hook",
				name: "tool_call",
				payload: {},
			}),
		).toBeUndefined();
	});
});

describe("selectSessionReplayIterations", () => {
	const iterations = buildSessionReplayIterations({
		transcript: { sessionId: FIXTURE_SESSION_ID, messages: fixtureMessages() },
	});

	it("selects an inclusive range", () => {
		expect(
			selectSessionReplayIterations(iterations, { from: 2 }).map(
				(iteration) => iteration.index,
			),
		).toEqual([2]);
		expect(
			selectSessionReplayIterations(iterations, { to: 1 }).map(
				(iteration) => iteration.index,
			),
		).toEqual([1]);
		expect(selectSessionReplayIterations(iterations, {})).toHaveLength(2);
	});

	it("rejects invalid ranges", () => {
		expect(() =>
			selectSessionReplayIterations(iterations, { from: 0 }),
		).toThrow("--from must be an integer >= 1");
		expect(() =>
			selectSessionReplayIterations(iterations, { from: 2, to: 1 }),
		).toThrow("--from (2) must not be greater than --to (1)");
		expect(() =>
			selectSessionReplayIterations(iterations, { from: 3 }),
		).toThrow(
			"--from (3) is past the last iteration; the session has 2 iterations",
		);
	});
});
