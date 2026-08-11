import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	buildPreviousTimestampMap,
	buildUserRunCountMap,
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
