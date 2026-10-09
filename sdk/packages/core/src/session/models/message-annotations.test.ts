import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	annotateCompactionMessages,
	annotatePersistedMessages,
} from "./message-annotations";

const toolUse = (id: string, ts?: number): MessageWithMetadata => ({
	role: "assistant",
	content: [{ type: "tool_use", id, name: "spawn_agent", input: {} }],
	...(ts !== undefined ? { ts } : {}),
});
const toolResult = (id: string, ts?: number): MessageWithMetadata => ({
	role: "user",
	content: [
		{
			type: "tool_result",
			tool_use_id: id,
			name: "spawn_agent",
			content: "done",
		},
	],
	...(ts !== undefined ? { ts } : {}),
});

describe("annotatePersistedMessages", () => {
	it("numbers model calls and their tool results by iteration", () => {
		const annotated = annotatePersistedMessages([
			{ role: "user", content: "go", ts: 1 },
			toolUse("a", 2),
			toolResult("a", 3),
			{ role: "assistant", content: "done", ts: 4 },
			{ role: "user", content: "again", ts: 5 },
			{ role: "assistant", content: "ok", ts: 6 },
		]);
		expect(annotated.map((message) => message.iteration)).toEqual([
			undefined,
			1,
			1,
			2,
			undefined,
			3,
		]);
	});

	it("drops an iteration that no longer matches the transcript", () => {
		const [message] = annotatePersistedMessages([
			{ role: "user", content: "go", ts: 1, iteration: 7 },
		]);
		expect(message).not.toHaveProperty("iteration");
	});

	it("fills missing timestamps from the nearest neighbour, then from now", () => {
		expect(
			annotatePersistedMessages([
				{ role: "user", content: "a" },
				{ role: "assistant", content: "b", ts: 10 },
				{ role: "user", content: "c" },
				{ role: "assistant", content: "d", ts: 20 },
			]).map((message) => message.ts),
		).toEqual([10, 10, 10, 20]);
		expect(
			annotatePersistedMessages([{ role: "user", content: "a" }], {
				now: () => 99,
			})[0]?.ts,
		).toBe(99);
	});

	it("links tool calls to the child sessions they started", () => {
		const annotated = annotatePersistedMessages(
			[{ role: "user", content: "go", ts: 1 }, toolUse("call_1", 2)],
			{
				childSessionLinks: (id) =>
					id === "call_1"
						? [{ toolCallId: id, sessionId: "root__agent_1", kind: "subagent" }]
						: undefined,
			},
		);
		expect(annotated[1]?.childSessions).toEqual([
			{ toolCallId: "call_1", sessionId: "root__agent_1", kind: "subagent" },
		]);
		expect(annotated[0]).not.toHaveProperty("childSessions");
	});

	it("keeps links already on the message", () => {
		const existing = {
			toolCallId: "call_1",
			sessionId: "root__agent_1",
			kind: "subagent" as const,
		};
		const [, assistant] = annotatePersistedMessages(
			[
				{ role: "user", content: "go", ts: 1 },
				{ ...toolUse("call_1", 2), childSessions: [existing] },
			],
			{ childSessionLinks: () => [existing] },
		);
		expect(assistant?.childSessions).toEqual([existing]);
	});

	it("marks compaction summaries", () => {
		const [summary, other] = annotatePersistedMessages([
			{
				role: "user",
				content: "summary",
				ts: 1,
				metadata: { kind: "compaction_summary", displayRole: "system" },
			},
			{
				role: "user",
				content: "kept",
				ts: 2,
				metadata: { kind: "compaction" },
			},
		]);
		expect(summary?.compactionSummary).toBe(true);
		expect(other).not.toHaveProperty("compactionSummary");
	});

	it("does not touch metadata, so compaction source hashes stay stable", () => {
		const metadata = { kind: "recovery_notice" };
		const [message] = annotatePersistedMessages([
			{ role: "user", content: "x", metadata },
		]);
		expect(message?.metadata).toBe(metadata);
	});
});

describe("annotateCompactionMessages", () => {
	it("marks summaries in a compaction sidecar", () => {
		expect(
			annotateCompactionMessages([
				{
					role: "user",
					content: "summary",
					metadata: { kind: "compaction_summary" },
				},
				{ role: "user", content: "kept" },
			]).map((message) => message.compactionSummary),
		).toEqual([true, undefined]);
	});
});
