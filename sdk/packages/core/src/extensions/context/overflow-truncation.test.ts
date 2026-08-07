import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { CoreCompactionContext } from "../../types/config";
import { runOverflowTruncation } from "./overflow-truncation";

const estimateJsonTokens = (message: MessageWithMetadata): number =>
	JSON.stringify(message).length;

function totalTokens(messages: MessageWithMetadata[]): number {
	return messages.reduce(
		(total, message) => total + estimateJsonTokens(message),
		0,
	);
}

function makeContext(
	messages: MessageWithMetadata[],
	targetTokens: number,
): CoreCompactionContext {
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		messages,
		model: { id: "mock-model", provider: "anthropic" },
		mode: "overflow_recovery",
		abortSignal: new AbortController().signal,
		budget: {
			request: {
				inputTokens: totalTokens(messages),
				maxInputTokens: targetTokens * 5,
				triggerTokens: targetTokens * 4,
				targetTokens,
				overheadTokens: 0,
				thresholdRatio: 0.9,
				utilizationRatio: 1,
			},
			messages: {
				inputTokens: totalTokens(messages),
				triggerTokens: targetTokens * 4,
				targetTokens,
			},
		},
	} as CoreCompactionContext;
}

function noticeText(messages: MessageWithMetadata[] | undefined): string {
	const first = messages?.[0];
	if (!first || !Array.isArray(first.content)) {
		return "";
	}
	return first.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n");
}

describe("runOverflowTruncation", () => {
	it("drops the oldest messages and replaces them with a notice", () => {
		const filler = "x".repeat(400);
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: `old request ${filler}` },
			{ role: "assistant", content: `old answer ${filler}` },
			{ role: "user", content: `another old request ${filler}` },
			{ role: "assistant", content: `another old answer ${filler}` },
			{ role: "user", content: "current request" },
			{ role: "assistant", content: "current answer" },
		];

		const result = runOverflowTruncation({
			context: makeContext(messages, 600),
			estimateMessageTokens: estimateJsonTokens,
		});

		expect(result?.messages).toBeDefined();
		const compacted = result?.messages ?? [];
		// Newest messages survive verbatim behind the notice.
		expect(compacted.at(-2)).toEqual({
			role: "user",
			content: "current request",
		});
		expect(compacted.at(-1)).toEqual({
			role: "assistant",
			content: "current answer",
		});
		expect(noticeText(compacted)).toContain(
			"exceeded the model's context window",
		);
		expect(noticeText(compacted)).toContain("4 message(s) were removed");
		expect(totalTokens(compacted)).toBeLessThanOrEqual(600);
		expect(totalTokens(compacted)).toBeLessThan(totalTokens(messages));
	});

	it("always drops at least the oldest message, even when the estimate says everything fits", () => {
		// The provider rejected the request, so the estimate is proven wrong;
		// returning the transcript unchanged would waste the run's one retry.
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "first" },
			{ role: "assistant", content: "second" },
			{ role: "user", content: "third" },
		];

		const result = runOverflowTruncation({
			context: makeContext(messages, 1_000_000),
			estimateMessageTokens: estimateJsonTokens,
		});

		expect(result?.messages.length).toBe(3);
		expect(noticeText(result?.messages)).toContain("1 message(s) were removed");
		expect(result?.messages.slice(1)).toEqual(messages.slice(1));
	});

	it("never splits a tool_use/tool_result pair at the cut", () => {
		const filler = "y".repeat(600);
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: `old request ${filler}` },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "pair-1",
						name: "read_files",
						input: { file_paths: ["/tmp/a.ts"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "pair-1",
						name: "read_files",
						content: `tool output ${filler}`,
					},
				],
			},
			{ role: "assistant", content: "final answer" },
		];

		// Target sized so a naive cut would land on the tool_result message.
		const target =
			estimateJsonTokens(messages[3]) + estimateJsonTokens(messages[2]) + 250;
		const result = runOverflowTruncation({
			context: makeContext(messages, target),
			estimateMessageTokens: estimateJsonTokens,
		});

		const compacted = result?.messages ?? [];
		const toolUseIds = new Set<string>();
		const toolResultIds = new Set<string>();
		for (const message of compacted) {
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type === "tool_use") {
					toolUseIds.add(block.id);
				}
				if (block.type === "tool_result") {
					toolResultIds.add(block.tool_use_id);
				}
			}
		}
		for (const id of toolResultIds) {
			expect(toolUseIds.has(id)).toBe(true);
		}
	});

	it("truncates oversized text when even the newest message exceeds the budget", () => {
		// The shape that dropping old messages alone cannot fix: the newest
		// message IS the problem — a tool call just returned a massive output.
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "do the thing" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "big-1",
						name: "run_commands",
						input: { commands: ["cat huge.log"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "big-1",
						name: "run_commands",
						content: "z".repeat(50_000),
					},
				],
			},
		];

		const result = runOverflowTruncation({
			context: makeContext(messages, 2_000),
			estimateMessageTokens: estimateJsonTokens,
		});

		expect(result?.messages).toBeDefined();
		const compacted = result?.messages ?? [];
		// The kept tail starts at the assistant owning the tool_use, so the
		// pair stays intact while its oversized result text is cut to budget.
		expect(
			compacted.some((message) =>
				JSON.stringify(message).includes('"tool_use"'),
			),
		).toBe(true);
		expect(totalTokens(compacted)).toBeLessThanOrEqual(2_000);
		expect(JSON.stringify(compacted)).toContain("[truncated");
		expect(noticeText(compacted)).toContain(
			"exceeded the model's context window",
		);
	});

	it("returns undefined for a single-message transcript", () => {
		const result = runOverflowTruncation({
			context: makeContext(
				[{ role: "user", content: "M".repeat(10_000) }],
				100,
			),
			estimateMessageTokens: estimateJsonTokens,
		});

		expect(result).toBeUndefined();
	});

	it("records the dropped user runs on the notice for checkpoint alignment", () => {
		const filler = "w".repeat(500);
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: `first request ${filler}` },
			{ role: "assistant", content: `first answer ${filler}` },
			{ role: "user", content: `second request ${filler}` },
			{ role: "assistant", content: `second answer ${filler}` },
			{ role: "user", content: "third request" },
			{ role: "assistant", content: "third answer" },
		];

		// Room for the notice plus the third turn, but not the second.
		const result = runOverflowTruncation({
			context: makeContext(messages, 700),
			estimateMessageTokens: estimateJsonTokens,
		});

		const notice = result?.messages[0];
		expect(notice?.metadata).toMatchObject({
			kind: "overflow_truncation",
			displayRole: "system",
			userRunSpan: 2,
		});
	});
});
