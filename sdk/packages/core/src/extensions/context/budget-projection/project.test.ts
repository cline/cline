import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	buildBudgetProjection,
	findLatestTypedUserMessageIndex,
} from "./project";

const estimateChars = (message: MessageWithMetadata) =>
	JSON.stringify(message).length;

describe("buildBudgetProjection", () => {
	it("fails explicitly for impossible budgets", () => {
		const result = buildBudgetProjection({
			messages: [{ role: "user", content: "keep me" }],
			targetTokens: 0,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		expect(result.status).toBe("failed");
		expect(result.messages).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("budget_impossible");
	});

	it("drops unsafe image and redacted thinking blocks instead of truncating them", () => {
		const result = buildBudgetProjection({
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "old context" },
						{
							type: "redacted_thinking",
							data: "x".repeat(500),
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "image",
							data: "y".repeat(500),
							mediaType: "image/png",
						},
					],
				},
				{ role: "user", content: "latest task" },
			],
			targetTokens: 150,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		const serialized = JSON.stringify(result.messages);
		expect(serialized).not.toContain("redacted_thinking");
		expect(serialized).not.toContain("image/png");
		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "dropped_block",
					reason: "unsafe_to_truncate",
				}),
			]),
		);
		expect(result.liveTailHandling).toBe("included_degraded");
	});

	it("keeps unsafe blocks when input is already under budget", () => {
		const result = buildBudgetProjection({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "look at this" },
						{
							type: "image",
							data: "small-image",
							mediaType: "image/png",
						},
					],
				},
			],
			targetTokens: 1_000,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		expect(result.status).toBe("ok");
		expect(result.actions).toEqual([]);
		expect(result.liveTailHandling).toBe("included_verbatim");
		expect(JSON.stringify(result.messages)).toContain("small-image");
	});

	it("preserves unsafe blocks in the latest typed user message", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "old task " + "x".repeat(500) },
				{
					role: "user",
					content: [
						{ type: "text", text: "what is in this image?" },
						{
							type: "image",
							data: "live-image",
							mediaType: "image/png",
						},
					],
				},
			],
			targetTokens: 120,
			policyIntent: "basic_compaction_projection",
			estimateMessageTokens: estimateChars,
		});

		expect(JSON.stringify(result.messages)).toContain("live-image");
		expect(result.actions).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "dropped_block" }),
			]),
		);
	});

	it("protects latest typed user after thinking-only messages are pruned", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "old task" },
				{
					role: "assistant",
					content: [{ type: "thinking", thinking: "discard me" }],
				},
				{
					role: "user",
					content: [
						{ type: "text", text: "what is in this image?" },
						{
							type: "image",
							data: "live-image",
							mediaType: "image/png",
						},
					],
				},
			],
			targetTokens: 1_000,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		const serialized = JSON.stringify(result.messages);
		expect(serialized).toContain("live-image");
		expect(serialized).not.toContain("discard me");
	});

	it("keeps tool-use and tool-result pairs coherent when dropping history", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "original task" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool_1",
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
							tool_use_id: "tool_1",
							name: "read_files",
							content: "x".repeat(1000),
						},
					],
				},
				{ role: "user", content: "latest task" },
			],
			targetTokens: 140,
			policyIntent: "basic_compaction_projection",
			estimateMessageTokens: estimateChars,
		});

		const serialized = JSON.stringify(result.messages);
		expect(serialized).not.toContain("tool_1");
		expect(serialized).toContain("latest task");
		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reason: "tool_pair_boundary" }),
			]),
		);
	});

	it("records budget action paths against original message indexes", () => {
		const result = buildBudgetProjection({
			messages: [
				{
					role: "assistant",
					content: [{ type: "image", data: "x", mediaType: "image/png" }],
				},
				{ role: "user", content: "old task " + "x".repeat(500) },
				{ role: "assistant", content: "old answer " + "y".repeat(500) },
				{ role: "user", content: "latest task" },
			],
			targetTokens: 80,
			policyIntent: "basic_compaction_projection",
			estimateMessageTokens: estimateChars,
		});

		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "preserved",
					path: expect.objectContaining({ messageIndex: 1 }),
				}),
				expect.objectContaining({
					kind: "dropped_message",
					path: expect.objectContaining({ messageIndex: 2 }),
				}),
			]),
		);
	});

	it("detects the latest typed user message when tool results follow it", () => {
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "old task" },
			{ role: "user", content: "latest typed prompt" },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool_1", name: "read", input: {} }],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "read",
						content: "result",
					},
				],
			},
		];

		expect(findLatestTypedUserMessageIndex(messages)).toBe(1);
	});

	it("preserves the latest typed prompt under pressure", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "old task " + "x".repeat(500) },
				{ role: "user", content: "latest typed prompt" },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_1",
							name: "read",
							content: "result " + "y".repeat(500),
						},
					],
				},
			],
			targetTokens: 120,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		expect(JSON.stringify(result.messages)).toContain("latest typed prompt");
		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reason: "protected_live_tail" }),
			]),
		);
	});

	it("drops completed tool pairs after the latest typed prompt", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "old task " + "x".repeat(500) },
				{ role: "user", content: "latest typed prompt" },
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tool_after", name: "read", input: {} },
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_after",
							name: "read",
							content: "huge result " + "y".repeat(2_000),
						},
					],
				},
			],
			targetTokens: 140,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		const serialized = JSON.stringify(result.messages);
		expect(serialized).toContain("latest typed prompt");
		expect(serialized).not.toContain("tool_after");
		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "dropped_message",
					reason: "tool_pair_boundary",
					path: expect.objectContaining({ messageIndex: 2 }),
				}),
				expect.objectContaining({
					kind: "dropped_message",
					reason: "tool_pair_boundary",
					path: expect.objectContaining({ messageIndex: 3 }),
				}),
			]),
		);
	});

	it("preserves unresolved tool use after the latest typed prompt", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "old task " + "x".repeat(500) },
				{ role: "user", content: "latest typed prompt" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool_live",
							name: "run_command",
							input: { command: "sleep 1" },
						},
					],
				},
			],
			targetTokens: 80,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		const serialized = JSON.stringify(result.messages);
		expect(serialized).toContain("latest typed prompt");
		expect(serialized).toContain("tool_live");
		expect(result.status).toBe("failed");
		expect(result.warnings[0]?.code).toBe(
			"budget_unachievable_with_protections",
		);
	});

	it("does not preserve later text or file blocks after tool-result budget is exhausted", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "latest typed prompt" },
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tool_live", name: "read", input: {} },
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_live",
							name: "read",
							content: [
								{ type: "text", text: "a".repeat(200) },
								{
									type: "file",
									path: "/tmp/huge.txt",
									content: "b".repeat(1_000),
								},
							],
						},
					],
				},
			],
			targetTokens: 260,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		const serialized = JSON.stringify(result.messages);
		expect(serialized).toContain("latest typed prompt");
		expect(serialized).not.toContain("b".repeat(100));
		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "truncated_text",
					reason: "over_budget",
				}),
			]),
		);
	});

	it("drops thinking blocks instead of mutating provider-native reasoning", () => {
		const result = buildBudgetProjection({
			messages: [
				{ role: "user", content: "latest typed prompt" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "a".repeat(1_000) },
						{ type: "thinking", thinking: "b".repeat(1_000) },
					],
				},
			],
			targetTokens: 900,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		const assistant = result.messages.find(
			(message) => message.role === "assistant",
		);
		expect(JSON.stringify(assistant)).not.toContain("b".repeat(100));
		expect(JSON.stringify(assistant)).not.toContain('"thinking"');
		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "dropped_block",
					reason: "unsafe_to_truncate",
				}),
			]),
		);
	});

	it("drops nested unsafe tool-result blocks outside the protected tail", () => {
		const result = buildBudgetProjection({
			messages: [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_old",
							name: "read",
							content: [
								{ type: "text", text: "old output" },
								{
									type: "image",
									data: "old-image-data",
									mediaType: "image/png",
								},
							],
						},
					],
				},
				{ role: "user", content: "latest typed prompt" },
			],
			targetTokens: 1_000,
			policyIntent: "agentic_summary",
			estimateMessageTokens: estimateChars,
		});

		const serialized = JSON.stringify(result.messages);
		expect(serialized).toContain("old output");
		expect(serialized).not.toContain("old-image-data");
		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "dropped_block",
					reason: "unsafe_to_truncate",
				}),
			]),
		);
	});
});
