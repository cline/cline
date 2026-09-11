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

	it("counts tool execution time when pre-tool thinking attaches to the answer", () => {
		// Canonical projection of a thinking-only assistant message that issued
		// a tool call: the tool row and the reasoning-only row are both stamped
		// with pre-execution timestamps, and the reasoning row attaches to the
		// run's final answer in groupChatMessages. The duration must span to
		// the answer itself (14_500), not to the pre-tool thinking (6_001) —
		// that would exclude the entire tool execution from "Worked for".
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "run it",
					createdAt: 1_000,
				}),
				makeTool("t1", 6_000),
				makeMessage({
					id: "r1",
					reasoning: "planning the command",
					createdAt: 6_001,
				}),
				makeMessage({ id: "a1", content: "Done.", createdAt: 14_500 }),
			],
			true,
		);

		const work = items.find((item) => item.type === "work");
		if (work?.type !== "work") throw new Error("expected work item");
		expect(work.toolCallCount).toBe(1);
		expect(work.durationMilliseconds).toBe(13_500);
	});

	it("clamps the duration to the collapsed rows when the answer's timestamp is earlier", () => {
		// A fallback answer bubble can be minted with a synthetic timestamp
		// near the send time (RPC completion path); it must not shrink the
		// duration below the work the run demonstrably performed.
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 5_000),
				makeMessage({ id: "a1", content: "Done.", createdAt: 1_001 }),
			],
			true,
		);

		const work = items.find((item) => item.type === "work");
		if (work?.type !== "work") throw new Error("expected work item");
		expect(work.durationMilliseconds).toBe(4_000);
	});

	function makeSubmitTool(id: string, createdAt: number): ChatMessage {
		return makeMessage({
			id,
			role: "tool",
			content: JSON.stringify({
				toolName: "submit_and_exit",
				input: { summary: "Report ready." },
				result: "Report ready.",
			}),
			createdAt,
		});
	}

	it("keeps a trailing submit_and_exit row visible as the collapsed run's answer", () => {
		// Scheduled runs end on submit_and_exit — its row carries the final
		// report, so it must not fold into the work summary.
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
				makeSubmitTool("submit", 5_000),
			],
			true,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"work",
			"tools",
		]);
		const work = items[1];
		if (work?.type !== "work") throw new Error("expected work item");
		expect(work.toolCallCount).toBe(1);
		expect(work.durationMilliseconds).toBe(4_000);
		const submit = items[2];
		if (submit?.type !== "tools") throw new Error("expected tools item");
		expect(submit.messages.map((message) => message.id)).toEqual(["submit"]);
	});

	it("keeps the submit_and_exit row visible once a later user message exists", () => {
		// A follow-up prompt in a finished scheduled session settles the run's
		// span; the report row must survive the collapse instead of hiding
		// inside the work summary.
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
				makeSubmitTool("submit", 5_000),
				makeMessage({
					id: "u2",
					role: "user",
					content: "thanks, one more thing",
					createdAt: 9_000,
				}),
			],
			false,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"work",
			"tools",
			"message",
		]);
		const submit = items[2];
		if (submit?.type !== "tools") throw new Error("expected tools item");
		expect(submit.messages.map((message) => message.id)).toEqual(["submit"]);
	});

	it("keeps a live run's trailing submit_and_exit with its working rows", () => {
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
					reasoning: "wrapping up",
					createdAt: 1_500,
				}),
				makeTool("t1", 2_000),
				makeSubmitTool("submit", 3_000),
			],
			false,
		);

		expect(items.map((item) => item.type)).toEqual(["message", "run"]);
		const run = items[1];
		if (run?.type !== "run") throw new Error("expected run item");
		const tools = run.items.at(-1);
		if (tools?.type !== "tools") throw new Error("expected tools item");
		expect(tools.messages.map((message) => message.id)).toEqual([
			"t1",
			"submit",
		]);
	});

	it("treats a mid-run submit_and_exit as ordinary work", () => {
		// Only a submit the run actually ended on is its deliverable; one
		// followed by more work folds with everything else.
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeSubmitTool("submit", 2_000),
				makeTool("t1", 3_000),
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
	});

	it("prefers trailing assistant text over an earlier submit as the answer", () => {
		// When the model narrates after submitting, the narration is the
		// answer and the run folds exactly as it did before the submit
		// special-case existed.
		const items = collapse(
			[
				makeMessage({
					id: "u1",
					role: "user",
					content: "go",
					createdAt: 1_000,
				}),
				makeTool("t1", 2_000),
				makeSubmitTool("submit", 3_000),
				makeMessage({ id: "a1", content: "All wrapped up.", createdAt: 4_000 }),
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
		const answer = items[2];
		if (answer?.type !== "message") throw new Error("expected message item");
		expect(answer.message.id).toBe("a1");
	});

	it("detects submit_and_exit from message meta when the content is not JSON", () => {
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
					id: "submit-meta",
					role: "tool",
					content: "not-json",
					meta: { toolName: "submit_and_exit" },
					createdAt: 3_000,
				}),
			],
			true,
		);

		expect(items.map((item) => item.type)).toEqual([
			"message",
			"work",
			"tools",
		]);
	});

	it("does not treat other trailing tool calls as the run's answer", () => {
		// A finished tail ending on an ordinary tool call still reads as an
		// interrupted run: rows stay visible, nothing collapses.
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
			],
			true,
		);

		expect(items.map((item) => item.type)).toEqual(["message", "tools"]);
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
