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
	selectSessionReplayIterations,
	sessionReplayIterationRunCounts,
} from "./bundle-iterations";
import { createSessionReplayRedactor } from "./bundle-redaction";

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

describe("sessionReplayIterationRunCounts", () => {
	it("numbers iterations by the span-aware user run they belong to", () => {
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: "Summary of three earlier turns",
				metadata: { kind: "compaction_summary", userRunSpan: 3 },
			},
			{ role: "assistant", content: "Continuing." },
			{ role: "user", content: "Run the tests" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "t1", name: "run_commands", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						name: "run_commands",
						content: "ok",
					},
				],
			},
			{
				role: "user",
				content: "[SYSTEM] Keep going.",
				metadata: { userRunSpan: 0 },
			},
			{ role: "assistant", content: "Tests pass." },
		];
		expect(sessionReplayIterationRunCounts(messages)).toEqual([3, 4, 4]);
		expect(
			buildSessionReplayIterations({
				transcript: { sessionId: "s", messages },
			}),
		).toHaveLength(3);
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
