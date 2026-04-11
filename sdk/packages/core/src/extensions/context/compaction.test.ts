import type * as LlmsProviders from "@clinebot/llms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextCompactionPrepareTurn } from "./compaction";

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

describe("createContextCompactionPrepareTurn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("summarizes older messages and keeps recent messages", async () => {
		const emitStatusNotice = vi.fn();
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

		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
				reserveTokens: 5,
			},
			logger: undefined,
		});

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			emitStatusNotice,
			systemPrompt: "You are helpful.",
			tools: [],
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
			apiMessages: [
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
				info: { id: "mock-model", contextWindow: 10 },
			},
		});

		expect(createHandlerMock).toHaveBeenCalledTimes(1);
		expect(emitStatusNotice).toHaveBeenCalledWith(
			"auto-compacting",
			expect.objectContaining({
				kind: "auto_compaction",
				reason: "auto_compaction",
				iteration: 1,
			}),
		);
		expect(result?.messages).toHaveLength(5);
		expect(result?.messages[0]).toMatchObject({
			role: "user",
			metadata: expect.objectContaining({
				kind: "compaction_summary",
				details: {
					readFiles: [],
					modifiedFiles: [],
				},
			}),
		});
		expect(typeof result?.messages[0]?.content).toBe("string");
		const summaryContent = result?.messages[0]?.content as string;
		expect(summaryContent).toContain("Context summary:");
		expect(summaryContent).toContain("## Files");
		expect(result?.messages[1]).toEqual({
			role: "user",
			content: "Implement the change",
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

		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "primary-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "primary-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
				reserveTokens: 5,
				summarizer: {
					providerId: "openai",
					modelId: "gpt-summary",
					maxOutputTokens: 512,
				},
			},
			logger: undefined,
		});

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages: [
				{ role: "user", content: "Old turn" },
				{ role: "assistant", content: "Old answer" },
				{ role: "user", content: "Latest turn" },
				{ role: "assistant", content: "Latest answer" },
			],
			apiMessages: [
				{ role: "user", content: "Old turn" },
				{ role: "assistant", content: "Old answer" },
				{ role: "user", content: "Latest turn" },
				{ role: "assistant", content: "Latest answer" },
			],
			model: {
				id: "primary-model",
				provider: "anthropic",
				info: { id: "primary-model", contextWindow: 10 },
			},
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
		const emitStatusNotice = vi.fn();
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "basic",
				reserveTokens: 5,
			},
			logger: undefined,
		});

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			emitStatusNotice,
			systemPrompt: "You are helpful.",
			tools: [],
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
			apiMessages: [
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
				info: { id: "mock-model", contextWindow: 10 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(emitStatusNotice).toHaveBeenCalledWith(
			"auto-compacting",
			expect.objectContaining({
				kind: "auto_compaction",
				reason: "auto_compaction",
			}),
		);
		expect(result?.messages).toBeDefined();
		expect(result?.messages.length).toBeGreaterThan(0);
		// Compacted messages should not contain tool_result content that was pruned.
		for (const message of result?.messages ?? []) {
			if (typeof message.content === "string") {
				expect(message.content).not.toContain(
					"tool output that should be removed",
				);
			} else {
				for (const block of message.content) {
					if (block.type === "text") {
						expect(block.text).not.toContain(
							"tool output that should be removed",
						);
					}
				}
			}
		}
	});

	it("defaults to threshold ratio when reserveTokens is not configured", async () => {
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true },
			logger: undefined,
		});

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages: [
				{ role: "user", content: "Short request" },
				{ role: "assistant", content: "Short reply" },
			],
			apiMessages: [
				{ role: "user", content: "Short request" },
				{ role: "assistant", content: "Short reply" },
			],
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", contextWindow: 100 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("does not compact when only pre-truncation messages exceed the threshold", async () => {
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				thresholdRatio: 0.8,
			},
			logger: undefined,
		});
		expect(prepareTurn).toBeDefined();

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages: [
				{ role: "user", content: "Initial request" },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "x".repeat(1000),
						},
					],
				},
			],
			apiMessages: [
				{ role: "user", content: "Initial request" },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "x".repeat(100),
						},
					],
				},
			],
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", contextWindow: 100 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});
});
