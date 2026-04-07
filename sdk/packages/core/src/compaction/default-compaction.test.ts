import type * as LlmsProviders from "@clinebot/llms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentCompaction } from "./default-compaction";

type FakeChunk = Record<string, unknown>;

const createHandlerMock = vi.fn();

vi.mock("@clinebot/llms", () => ({
	createHandler: (config: unknown) => createHandlerMock(config),
}));

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

describe("createDefaultAgentCompaction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("summarizes older messages and keeps recent messages", async () => {
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(() =>
				streamChunks([
					{
						type: "text",
						id: "summary-1",
						text: "## Goal\nShip the feature\n\n## Next\n- Finish it",
					},
					{ type: "done", id: "summary-1", success: true },
				]),
			),
		});

		const compaction = createDefaultAgentCompaction({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				preserveRecentTokens: 1,
				reserveTokens: 5,
			},
			logger: undefined,
		});

		const result = await compaction?.compact?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			messages: [
				{ role: "user", content: "Old turn to compact" },
				{ role: "assistant", content: "Old answer" },
				{ role: "user", content: "Implement the change" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_files",
							input: { file_paths: ["/tmp/example.ts"] },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "file contents",
						},
					],
				},
				{ role: "assistant", content: "Recent assistant state" },
			],
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", contextWindow: 100 },
			},
			usage: {
				inputTokens: 90,
				outputTokens: 10,
				totalTokens: 100,
			},
			totalUsage: {
				inputTokens: 90,
				outputTokens: 10,
			},
			contextWindowTokens: 100,
			triggerTokens: 95,
			thresholdRatio: 0.95,
			utilizationRatio: 0.9,
		});

		expect(createHandlerMock).toHaveBeenCalledTimes(1);
		expect(result?.messages).toHaveLength(5);
		expect(result?.messages[0]).toMatchObject({
			role: "user",
			metadata: expect.objectContaining({
				kind: "compaction_summary",
				details: {
					readFiles: [],
					modifiedFiles: [],
				},
				tokensBefore: 90,
			}),
		});
		expect(typeof result?.messages[0]?.content).toBe("string");
		const summaryContent = result?.messages[0]?.content as string;
		expect(summaryContent).toContain("Context summary:");
		expect(summaryContent).toContain("## Files");
		expect(summaryContent).toContain("Read:");
		expect(summaryContent).toContain("- none");
		expect(result?.messages[1]).toEqual({
			role: "user",
			content: "Implement the change",
		});
		expect(result?.messages[2]).toMatchObject({
			role: "assistant",
		});
		expect(result?.messages[4]).toEqual({
			role: "assistant",
			content: "Recent assistant state",
		});
	});

	it("uses the configured summarizer model for compaction", async () => {
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(() =>
				streamChunks([
					{ type: "text", id: "summary-3", text: "## Goal\nSummarized" },
					{ type: "done", id: "summary-3", success: true },
				]),
			),
		});

		const compaction = createDefaultAgentCompaction({
			providerId: "anthropic",
			modelId: "primary-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "primary-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				preserveRecentTokens: 1,
				summarizer: {
					providerId: "openai",
					modelId: "gpt-summary",
					maxOutputTokens: 512,
				},
			},
			logger: undefined,
		});

		await compaction?.compact?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			messages: [
				{ role: "user", content: "Old turn" },
				{ role: "assistant", content: "Old answer" },
				{ role: "user", content: "Latest turn" },
				{ role: "assistant", content: "Latest answer" },
			],
			model: {
				id: "primary-model",
				provider: "anthropic",
				info: { id: "primary-model", contextWindow: 100 },
			},
			usage: {
				inputTokens: 90,
				outputTokens: 10,
				totalTokens: 100,
			},
			totalUsage: {
				inputTokens: 90,
				outputTokens: 10,
			},
			contextWindowTokens: 100,
			triggerTokens: 95,
			thresholdRatio: 0.95,
			utilizationRatio: 0.9,
		});

		expect(createHandlerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "openai",
				modelId: "gpt-summary",
				maxOutputTokens: 512,
				thinking: false,
			}),
		);
	});

	it("uses basic compaction without calling the summarizer", async () => {
		const compaction = createDefaultAgentCompaction({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				strategy: "basic",
				reserveTokens: 10,
			},
			logger: undefined,
		});

		const result = await compaction?.compact?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			messages: [
				{ role: "user", content: "Initial request that should survive" },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "internal reasoning" },
						{ type: "text", text: "Older assistant explanation" },
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_files",
							input: { file_paths: ["/tmp/example.ts"] },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "tool output that should be removed",
						},
					],
				},
				{
					role: "user",
					content: [
						{ type: "text", text: "Most recent user turn" },
						{
							type: "image",
							data: "abc",
							mediaType: "image/png",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Most recent assistant reply" },
						{
							type: "file",
							path: "/tmp/out.ts",
							content: "export const value = 1;",
						},
					],
				},
			],
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", contextWindow: 100 },
			},
			usage: {
				inputTokens: 90,
				outputTokens: 10,
				totalTokens: 100,
			},
			totalUsage: {
				inputTokens: 90,
				outputTokens: 10,
			},
			contextWindowTokens: 100,
			triggerTokens: 30,
			thresholdRatio: 0.3,
			utilizationRatio: 0.9,
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(result?.messages).toEqual([
			{ role: "user", content: "Initial request that should survive" },
			{ role: "user", content: "Most recent user turn" },
			{ role: "assistant", content: "Most recent assistant reply" },
		]);
	});
});
