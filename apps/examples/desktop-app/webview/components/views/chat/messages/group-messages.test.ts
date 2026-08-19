import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	buildPreviousTimestampMap,
	buildUserRunCountMap,
	type ChatRenderItem,
	collapseCompletedWork,
	formatThoughtLabel,
	getThoughtDurationMilliseconds,
	groupChatMessages,
} from "./group-messages";

function makeMessage(
	overrides: Partial<ChatMessage> & { id: string },
): ChatMessage {
	return {
		sessionId: "session-1",
		role: "assistant",
		content: "",
		createdAt: 1,
		...overrides,
	} as ChatMessage;
}

describe("groupChatMessages", () => {
	it("folds a reasoning-only assistant message into the next assistant message", () => {
		const reasoningOnly = makeMessage({
			id: "reasoning",
			reasoning: "thinking hard",
		});
		const answer = makeMessage({ id: "answer", content: "Here you go." });

		const items = groupChatMessages([reasoningOnly, answer]);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			type: "message",
			agentRole: "assistant",
			message: answer,
			reasoningMessages: [reasoningOnly],
		});
	});

	it("keeps reasoning attached to an assistant message that carries its own reasoning", () => {
		const reasoningOnly = makeMessage({ id: "r1", reasoning: "step one" });
		const answer = makeMessage({
			id: "answer",
			content: "Done.",
			reasoning: "step two",
		});

		const items = groupChatMessages([reasoningOnly, answer]);

		expect(items).toHaveLength(1);
		expect(
			items[0].type === "message" ? items[0].reasoningMessages : [],
		).toEqual([reasoningOnly, answer]);
	});

	it("flushes trailing reasoning-only messages as a standalone assistant item", () => {
		const user = makeMessage({ id: "user", role: "user", content: "Hi" });
		const reasoningOnly = makeMessage({
			id: "reasoning",
			reasoning: "pondering",
		});

		const items = groupChatMessages([user, reasoningOnly]);

		expect(items).toHaveLength(2);
		expect(items[1]).toMatchObject({
			type: "message",
			agentRole: "assistant",
			message: reasoningOnly,
			reasoningMessages: [reasoningOnly],
		});
	});

	it("treats a redacted-reasoning assistant message without content as reasoning-only", () => {
		const redacted = makeMessage({ id: "redacted", reasoningRedacted: true });
		const answer = makeMessage({ id: "answer", content: "Answer." });

		const items = groupChatMessages([redacted, answer]);

		expect(items).toHaveLength(1);
		expect(
			items[0].type === "message" ? items[0].reasoningMessages : [],
		).toEqual([redacted]);
	});

	it("collapses consecutive tool messages into one tools item", () => {
		const toolA = makeMessage({ id: "tool-a", role: "tool", content: "{}" });
		const toolB = makeMessage({ id: "tool-b", role: "tool", content: "{}" });
		const answer = makeMessage({ id: "answer", content: "Done." });
		const toolC = makeMessage({ id: "tool-c", role: "tool", content: "{}" });

		const items = groupChatMessages([toolA, toolB, answer, toolC]);

		expect(items).toHaveLength(3);
		expect(items[0]).toEqual({ type: "tools", messages: [toolA, toolB] });
		expect(items[2]).toEqual({ type: "tools", messages: [toolC] });
	});

	it("does not merge tool runs across an interleaved message", () => {
		const toolA = makeMessage({ id: "tool-a", role: "tool", content: "{}" });
		const status = makeMessage({
			id: "status",
			role: "status",
			content: "working",
		});
		const toolB = makeMessage({ id: "tool-b", role: "tool", content: "{}" });

		const items = groupChatMessages([toolA, status, toolB]);

		expect(items).toHaveLength(3);
		expect(items[0]).toEqual({ type: "tools", messages: [toolA] });
		expect(items[2]).toEqual({ type: "tools", messages: [toolB] });
	});
});

describe("collapseCompletedWork", () => {
	function makeTool(id: string, createdAt: number): ChatMessage {
		return makeMessage({
			id,
			role: "tool",
			content: JSON.stringify({ toolName: "search", input: {}, result: {} }),
			createdAt,
		});
	}

	function collapse(
		messages: ChatMessage[],
		collapseTrailingRun: boolean,
	): ChatRenderItem[] {
		return collapseCompletedWork(groupChatMessages(messages), {
			collapseTrailingRun,
		});
	}

	it("collapses a finished run's tool calls behind its answer", () => {
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
				makeTool("t2", 3_000),
				makeMessage({ id: "a1", content: "Done.", createdAt: 5_000 }),
			],
			true,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"work",
			"message",
		]);
		const work = items[1];
		if (work?.type !== "work") throw new Error("expected work item");
		expect(work.toolCallCount).toBe(2);
		// "Worked for" counts from the user message that started the run.
		expect(work.durationMilliseconds).toBe(4_000);
		expect(work.id).toBe("t1");
		expect(work.items.map((item) => item.type)).toEqual(["tools"]);
	});

	it("groups a live run's working rows into a tight run item", () => {
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeMessage({
					id: "r1",
					reasoning: "planning",
					createdAt: 2_000,
				}),
				makeTool("t1", 3_000),
				makeTool("t2", 4_000),
				makeMessage({ id: "a1", content: "Done.", createdAt: 5_000 }),
			],
			false,
		);

		// The thought row and tool rows share one run group while streaming;
		// the answer-in-progress stays outside at transcript level.
		expect(items.map((item) => item.type)).toEqual([
			"message",
			"run",
			"message",
		]);
		const run = items[1];
		if (run?.type !== "run") throw new Error("expected run item");
		expect(run.id).toBe("r1");
		expect(run.items.map((item) => item.type)).toEqual(["message", "tools"]);
	});

	it("keeps the live trailing run expanded", () => {
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
				makeMessage({ id: "a1", content: "Done.", createdAt: 3_000 }),
			],
			false,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"tools",
			"message",
		]);
	});

	it("keeps a trailing run without an answer expanded even when idle", () => {
		// A cancelled or failed run never ended on assistant text; its rows stay
		// visible so the user can see where it stopped.
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
			],
			true,
		);

		expect(items.map((item) => item.type)).toEqual(["message", "tools"]);
	});

	it("collapses answerless runs once a later user message exists", () => {
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
				makeMessage({
					id: "u2",
					role: "user",
					content: "next",
					createdAt: 9_000,
				}),
			],
			false,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"work",
			"message",
		]);
	});

	it("leaves runs without tool calls untouched", () => {
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "hi",
					createdAt: 1_000,
				}),
				makeMessage({
					id: "r1",
					reasoning: "hmm",
					createdAt: 2_000,
				}),
				makeMessage({ id: "a1", content: "Hello!", createdAt: 3_000 }),
			],
			true,
		);

		expect(items.map((item) => item.type)).toEqual(["message", "message"]);
	});

	it("folds thinking traces and narration into the work item", () => {
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeMessage({
					id: "r1",
					reasoning: "planning",
					createdAt: 2_000,
				}),
				makeTool("t1", 3_000),
				makeMessage({ id: "n1", content: "Halfway there.", createdAt: 4_000 }),
				makeTool("t2", 5_000),
				makeMessage({ id: "a1", content: "Done.", createdAt: 6_000 }),
			],
			true,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"work",
			"message",
		]);
		const work = items[1];
		if (work?.type !== "work") throw new Error("expected work item");
		expect(work.toolCallCount).toBe(2);
		expect(work.items.map((item) => item.type)).toEqual([
			"message",
			"tools",
			"message",
			"tools",
		]);
	});

	it("keeps assistant messages with attachments out of the collapse", () => {
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
				makeMessage({
					id: "img",
					images: [{ id: "i1", mediaType: "image/png", data: "aGk=" }],
					createdAt: 3_000,
				}),
				makeTool("t2", 4_000),
				makeMessage({ id: "a1", content: "Done.", createdAt: 5_000 }),
				makeMessage({
					id: "u2",
					role: "user",
					content: "next",
					createdAt: 9_000,
				}),
			],
			false,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"work",
			"message",
			"work",
			"message",
			"message",
		]);
	});

	it("measures duration from the first working row when no user message precedes it", () => {
		const items = collapse(
			[
				makeTool("t1", 2_000),
				makeMessage({ id: "a1", content: "Done.", createdAt: 9_000 }),
			],
			true,
		);

		const work = items[0];
		if (work?.type !== "work") throw new Error("expected work item");
		expect(work.durationMilliseconds).toBe(7_000);
	});
});

describe("buildPreviousTimestampMap", () => {
	it("maps each message to the timestamp of the previous datable message", () => {
		const first = makeMessage({ id: "first", createdAt: 100 });
		const undated = makeMessage({ id: "undated", createdAt: Number.NaN });
		const last = makeMessage({ id: "last", createdAt: 300 });

		const map = buildPreviousTimestampMap([first, undated, last]);

		expect(map.get(first)).toBeUndefined();
		expect(map.get(undated)).toBe(100);
		// The undated message must not overwrite the running timestamp.
		expect(map.get(last)).toBe(100);
	});
});

describe("buildUserRunCountMap", () => {
	it("increments the run count for each user message", () => {
		const userA = makeMessage({ id: "user-a", role: "user", content: "one" });
		const reply = makeMessage({ id: "reply", content: "ok" });
		const userB = makeMessage({ id: "user-b", role: "user", content: "two" });

		const map = buildUserRunCountMap([userA, reply, userB]);

		expect(map.get(userA)).toBe(1);
		expect(map.get(userB)).toBe(2);
	});

	it("prefers stored run counts from message meta", () => {
		const restored = makeMessage({
			id: "restored",
			role: "user",
			content: "restored",
			meta: { runCount: 5 },
		});
		const next = makeMessage({ id: "next", role: "user", content: "next" });

		const map = buildUserRunCountMap([restored, next]);

		expect(map.get(restored)).toBe(5);
		expect(map.get(next)).toBe(6);
	});

	it("skips user messages whose runSpan is zero and reads checkpoint run counts", () => {
		const spanless = makeMessage({
			id: "spanless",
			role: "user",
			content: "queued",
			meta: { userRunSpan: 0 },
		});
		const checkpointed = makeMessage({
			id: "checkpointed",
			role: "user",
			content: "checkpointed",
			meta: {
				checkpoint: { ref: "abc", createdAt: 1, runCount: 3, kind: "auto" },
			},
		});

		const map = buildUserRunCountMap([spanless, checkpointed]);

		expect(map.has(spanless)).toBe(false);
		expect(map.get(checkpointed)).toBe(3);
	});
});

describe("getThoughtDurationMilliseconds", () => {
	it("returns the delta between the previous message and the thinking message", () => {
		expect(getThoughtDurationMilliseconds(1_000, 4_000)).toBe(3_000);
	});

	it("returns undefined for missing, non-finite, or out-of-order timestamps", () => {
		expect(getThoughtDurationMilliseconds(undefined, 4_000)).toBeUndefined();
		expect(getThoughtDurationMilliseconds(Number.NaN, 4_000)).toBeUndefined();
		expect(getThoughtDurationMilliseconds(1_000, Number.NaN)).toBeUndefined();
		expect(getThoughtDurationMilliseconds(4_000, 1_000)).toBeUndefined();
	});
});

describe("formatThoughtLabel", () => {
	it("falls back to a plain label without a duration", () => {
		expect(formatThoughtLabel(undefined)).toBe("Thinking");
	});

	it("rounds to seconds with a one-second floor for nonzero durations", () => {
		expect(formatThoughtLabel(0)).toBe("Thought for 0s");
		expect(formatThoughtLabel(120)).toBe("Thought for 1s");
		expect(formatThoughtLabel(2_600)).toBe("Thought for 3s");
	});
});
