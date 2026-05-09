import type { MessageWithMetadata } from "@clinebot/llms";
import type { AgentResult } from "@clinebot/shared";
import { describe, expect, it } from "vitest";
import { withLatestAssistantTurnMetadata } from "./session-data";

type LegacyStoredMessage = MessageWithMetadata & {
	providerId?: string;
	modelId?: string;
};

function createResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 3,
			outputTokens: 2,
			totalCost: 0.01,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: {
			id: "claude-sonnet-4-6",
			provider: "anthropic",
			info: {
				id: "claude-sonnet-4-6",
				family: "claude-sonnet-4",
			},
		},
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	};
}

describe("withLatestAssistantTurnMetadata", () => {
	it("normalizes legacy stored provider/model fields into modelInfo", () => {
		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "first answer" },
			{ role: "user", content: "again" },
			{ role: "assistant", content: "second answer" },
		] as const;

		const previousMessages: LegacyStoredMessage[] = [
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: "first answer",
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
			},
			{ role: "user", content: "again" },
		];

		const persisted = withLatestAssistantTurnMetadata(
			[...messages],
			createResult(),
			previousMessages,
		);

		expect(persisted[1]).toEqual({
			id: expect.any(String),
			role: "assistant",
			content: "first answer",
			modelInfo: {
				id: "claude-sonnet-4-5",
				provider: "anthropic",
			},
		});
		expect(persisted[3]).toMatchObject({
			id: expect.any(String),
			role: "assistant",
			content: "second answer",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
				family: "claude-sonnet-4",
			},
			metrics: {
				inputTokens: 3,
				outputTokens: 2,
				cost: 0.01,
			},
		});
		expect("providerId" in (persisted[1] ?? {})).toBe(false);
		expect("modelId" in (persisted[1] ?? {})).toBe(false);
		expect("providerId" in (persisted[3] ?? {})).toBe(false);
		expect("modelId" in (persisted[3] ?? {})).toBe(false);
	});

	it("falls back to result.usage on the terminal assistant message when no per-turn metrics are pre-stamped (legacy / non-agent-loop path)", () => {
		const persisted = withLatestAssistantTurnMetadata(
			[
				{ role: "user", content: "spawn a team" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "1", name: "spawn", input: {} }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Both agents are spawned! Now let me send them tasks.",
						},
						{ type: "tool_use", id: "2", name: "run_task", input: {} },
					],
				},
			],
			createResult({
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
					totalCost: 0.12,
				},
			}),
			[],
		);

		expect(persisted[1]).toMatchObject({
			role: "assistant",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
				family: "claude-sonnet-4",
			},
		});
		expect(persisted[1]).not.toHaveProperty("metrics");
		expect(persisted[3]).toMatchObject({
			role: "assistant",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
				family: "claude-sonnet-4",
			},
			metrics: {
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 2,
				cacheWriteTokens: 1,
				cost: 0.12,
			},
		});
	});

	it("preserves per-turn metrics already stamped on assistant messages instead of overwriting with total run usage", () => {
		// The agent loop stamps per-turn metrics onto each assistant message
		// before appending it to the conversation store. This test verifies that
		// withLatestAssistantTurnMetadata preserves those per-turn values.
		const persisted = withLatestAssistantTurnMetadata(
			[
				{ role: "user", content: "do something" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "1", name: "bash", input: {} }],
					metrics: {
						inputTokens: 100,
						outputTokens: 50,
						cacheReadTokens: 10,
						cacheWriteTokens: 5,
						cost: 0.05,
					},
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "1", content: "done" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "All done." }],
					metrics: {
						inputTokens: 200,
						outputTokens: 80,
						cacheReadTokens: 20,
						cacheWriteTokens: 8,
						cost: 0.09,
					},
				},
			] as MessageWithMetadata[],
			createResult({
				usage: {
					inputTokens: 300,
					outputTokens: 130,
					cacheReadTokens: 30,
					cacheWriteTokens: 13,
					totalCost: 0.14,
				},
			}),
			[],
		);

		// First assistant message: per-turn metrics preserved, NOT overwritten with totals
		expect(persisted[1]).toMatchObject({
			metrics: {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 10,
				cacheWriteTokens: 5,
				cost: 0.05,
			},
		});
		// Last assistant message: per-turn metrics preserved, NOT overwritten with totals
		expect(persisted[3]).toMatchObject({
			metrics: {
				inputTokens: 200,
				outputTokens: 80,
				cacheReadTokens: 20,
				cacheWriteTokens: 8,
				cost: 0.09,
			},
		});
	});
});
