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

	it("applies turn model metadata and usage to every assistant message created in the turn", () => {
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
			metrics: {
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 2,
				cacheWriteTokens: 1,
				cost: 0.12,
			},
		});
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
});
