import type * as LlmsProviders from "@cline/llms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreCompactionContext } from "../../types/config";
import { runBasicCompaction } from "./basic-compaction";
import { createContextCompactionPrepareTurn } from "./compaction";
import {
	createTokenEstimator,
	resolveSummarizerConfig,
	serializeMessage,
	TOOL_RESULT_CHAR_LIMIT,
} from "./compaction-shared";

type FakeChunk = Record<string, unknown>;

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

const estimateJsonTokens = (message: LlmsProviders.Message): number =>
	JSON.stringify(message).length;

function totalJsonTokens(messages: LlmsProviders.Message[]): number {
	return messages.reduce(
		(total, message) => total + estimateJsonTokens(message),
		0,
	);
}

function runForcedBasicCompaction(
	messages: LlmsProviders.Message[],
	targetTokens: number,
): LlmsProviders.Message[] {
	const result = runBasicCompaction({
		context: {
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: targetTokens },
			},
			maxInputTokens: targetTokens,
			triggerTokens: targetTokens,
			thresholdRatio: 1,
			utilizationRatio: 2,
		},
		estimateMessageTokens: estimateJsonTokens,
	});
	return result?.messages ?? messages;
}

function assistantToolUseMessage(
	id: string,
	extraContent: LlmsProviders.ContentBlock[] = [],
): LlmsProviders.Message {
	return {
		role: "assistant",
		content: [
			...extraContent,
			{
				type: "tool_use",
				id,
				name: "read_files",
				input: { file_paths: [`/tmp/${id}.ts`] },
			},
		],
	};
}

function assistantMultiToolUseMessage(ids: string[]): LlmsProviders.Message {
	return {
		role: "assistant",
		content: ids.map((id) => ({
			type: "tool_use",
			id,
			name: "read_files",
			input: { file_paths: [`/tmp/${id}.ts`] },
		})),
	};
}

function toolResultMessage(
	id: string,
	content = "tool result",
): LlmsProviders.Message {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: id,
				content,
			},
		],
	};
}

function collectToolPairPresence(messages: LlmsProviders.Message[]): Map<
	string,
	{
		hasResult: boolean;
		hasUse: boolean;
	}
> {
	const presence = new Map<string, { hasResult: boolean; hasUse: boolean }>();
	const ensure = (id: string) => {
		const existing = presence.get(id);
		if (existing) {
			return existing;
		}
		const next = { hasResult: false, hasUse: false };
		presence.set(id, next);
		return next;
	};
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				ensure(block.id).hasUse = true;
			} else if (block.type === "tool_result") {
				ensure(block.tool_use_id).hasResult = true;
			}
		}
	}
	return presence;
}

function expectNoOrphanedToolPairs(messages: LlmsProviders.Message[]): void {
	for (const [id, presence] of collectToolPairPresence(messages)) {
		expect(presence, `tool pair ${id}`).toEqual({
			hasResult: presence.hasUse,
			hasUse: presence.hasResult,
		});
	}
}

describe("createContextCompactionPrepareTurn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("truncates text-block tool results when serializing compaction input", () => {
		const longToolOutput = "x".repeat(TOOL_RESULT_CHAR_LIMIT + 100);

		const serializedStringResult = serializeMessage({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool-1",
					content: longToolOutput,
				},
			],
		});
		const serializedTextBlockResult = serializeMessage({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool-1",
					content: [{ type: "text", text: longToolOutput }],
				},
			],
		});

		expect(serializedTextBlockResult).toBe(serializedStringResult);
		expect(serializedTextBlockResult).toContain(`...[truncated 100 chars]`);
		expect(serializedTextBlockResult.length).toBeLessThan(
			longToolOutput.length,
		);
	});

	it("truncates retained arbitrary tool results during basic compaction", () => {
		const omittedTail = "TAIL_SHOULD_NOT_SURVIVE_BASIC_COMPACTION";
		const longToolOutput =
			"x".repeat(TOOL_RESULT_CHAR_LIMIT + 5_000) + omittedTail;
		const result = runBasicCompaction({
			context: {
				agentId: "agent-1",
				conversationId: "conv-1",
				parentAgentId: null,
				iteration: 1,
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "tool-custom",
								name: "custom_reporter",
								input: {},
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "tool-custom",
								content: [{ type: "text", text: longToolOutput }],
							},
						],
					},
				],
				model: {
					id: "mock-model",
					provider: "anthropic",
					info: { id: "mock-model", maxInputTokens: 100_000 },
				},
				maxInputTokens: 100_000,
				triggerTokens: 100_000,
				thresholdRatio: 1,
				utilizationRatio: 0.1,
			},
			estimateMessageTokens: createTokenEstimator(),
		});

		expect(result?.messages).toHaveLength(2);
		const toolResultMessage = result?.messages[1];
		expect(Array.isArray(toolResultMessage?.content)).toBe(true);
		const block = Array.isArray(toolResultMessage?.content)
			? toolResultMessage.content[0]
			: undefined;
		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result" || typeof block.content === "string") {
			throw new Error("expected structured tool result");
		}
		expect(block.content[0]).toEqual(
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("...[truncated"),
			}),
		);
		expect(JSON.stringify(result?.messages)).not.toContain(omittedTail);
	});

	it("protects a fresh tool result from basic compaction", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Read the file" },
			assistantToolUseMessage("tool-a"),
			toolResultMessage("tool-a", "a".repeat(1_000)),
		];
		const targetTokens =
			totalJsonTokens(messages) - estimateJsonTokens(messages[2]) + 10;

		const compacted = runForcedBasicCompaction(messages, targetTokens);

		expectNoOrphanedToolPairs(compacted);
		expect(collectToolPairPresence(compacted).get("tool-a")).toEqual({
			hasResult: true,
			hasUse: true,
		});
	});

	it("removes older tool pairs atomically while preserving a newer pair", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Read the files" },
			assistantToolUseMessage("tool-a"),
			toolResultMessage("tool-a", "a".repeat(1_000)),
			{ role: "user", content: "Read the latest file" },
			assistantToolUseMessage("tool-b"),
			toolResultMessage("tool-b", "latest result"),
		];
		const targetTokens =
			totalJsonTokens(messages) -
			estimateJsonTokens(messages[1]) -
			estimateJsonTokens(messages[2]) +
			10;

		const compacted = runForcedBasicCompaction(messages, targetTokens);
		const pairs = collectToolPairPresence(compacted);

		expectNoOrphanedToolPairs(compacted);
		expect(pairs.get("tool-a")).toBeUndefined();
		expect(pairs.get("tool-b")).toEqual({ hasResult: true, hasUse: true });
	});

	it("preserves the latest tool pair under aggressive basic compaction", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Read the files" },
			assistantToolUseMessage("tool-a"),
			toolResultMessage("tool-a", "a".repeat(1_000)),
			{ role: "user", content: "Read the latest file" },
			assistantToolUseMessage("tool-b"),
			toolResultMessage("tool-b", "b".repeat(1_000)),
		];

		const compacted = runForcedBasicCompaction(messages, 1);
		const pairs = collectToolPairPresence(compacted);

		expectNoOrphanedToolPairs(compacted);
		expect(pairs.get("tool-a")).toBeUndefined();
		expect(pairs.get("tool-b")).toEqual({ hasResult: true, hasUse: true });
	});

	it("treats multi-tool assistant turns as one atomic group in basic compaction", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Read both old files" },
			assistantMultiToolUseMessage(["tool-a", "tool-b"]),
			toolResultMessage("tool-a", "a".repeat(1_000)),
			toolResultMessage("tool-b", "b".repeat(1_000)),
			{ role: "user", content: "Now continue" },
		];
		const targetTokens =
			totalJsonTokens(messages) - estimateJsonTokens(messages[2]) + 10;

		const compacted = runForcedBasicCompaction(messages, targetTokens);

		expectNoOrphanedToolPairs(compacted);
		expect(collectToolPairPresence(compacted).size).toBe(0);
	});

	it("removes matching tool results when basic compaction removes an assistant tool use", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Read and continue" },
			assistantToolUseMessage("tool-a", [
				{ type: "text", text: "large assistant context ".repeat(100) },
			]),
			toolResultMessage("tool-a", "short result"),
			{ role: "user", content: "Latest user turn" },
			{ role: "assistant", content: "latest assistant response" },
		];
		const targetTokens =
			totalJsonTokens(messages) - estimateJsonTokens(messages[1]) + 10;

		const compacted = runForcedBasicCompaction(messages, targetTokens);

		expectNoOrphanedToolPairs(compacted);
		expect(collectToolPairPresence(compacted).get("tool-a")).toBeUndefined();
	});

	it("preserves the latest typed user turn with its tool work during basic compaction", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Old request" },
			{ role: "assistant", content: "Old answer that can be compacted" },
			{ role: "user", content: "Read the latest file" },
			assistantToolUseMessage("tool-a"),
			toolResultMessage("tool-a", "latest result"),
		];

		const compacted = runForcedBasicCompaction(messages, 1);

		expect(compacted).toEqual([
			{ role: "user", content: "Old request" },
			{ role: "user", content: "Read the latest file" },
			assistantToolUseMessage("tool-a"),
			toolResultMessage("tool-a", "latest result"),
		]);
	});

	it("does not compact a single typed user message", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Only current request" },
		];

		const compacted = runForcedBasicCompaction(messages, 1);

		expect(compacted).toBe(messages);
	});

	it("does not add unsupported max output tokens to Codex OAuth summarizer requests", () => {
		const codexConfig = resolveSummarizerConfig({
			activeProviderConfig: {
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				maxOutputTokens: 16_000,
			},
		});
		const anthropicConfig = resolveSummarizerConfig({
			activeProviderConfig: {
				providerId: "anthropic",
				modelId: "claude-sonnet",
			},
		});

		expect(codexConfig).not.toHaveProperty("maxOutputTokens");
		expect(codexConfig.thinking).toBe(false);
		expect(anthropicConfig.maxOutputTokens).toBe(1_024);
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
				info: { id: "mock-model", maxInputTokens: 10 },
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

	it("sends truncated text-block tool results to the agentic summarizer", async () => {
		const createMessage = vi.fn(() =>
			streamChunks([
				{
					type: "text",
					id: "summary-tool-output",
					text: "## Goal\nSummarized tool output\n\n## Next\nContinue",
				},
				{ type: "done", id: "summary-tool-output", success: true },
			]),
		);
		createHandlerMock.mockReturnValue({ createMessage });
		const omittedTail = "TAIL_SHOULD_NOT_REACH_SUMMARIZER";
		const longToolOutput =
			"x".repeat(TOOL_RESULT_CHAR_LIMIT + 10_000) + omittedTail;
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

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages: [
				{ role: "user", content: "Run a large command" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-large",
							name: "execute_command",
							input: { command: "print-large-output" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-large",
							content: [{ type: "text", text: longToolOutput }],
						},
					],
				},
				{ role: "assistant", content: "Observed large output" },
				{ role: "user", content: "Latest request" },
				{ role: "assistant", content: "Latest answer" },
			],
			apiMessages: [
				{ role: "user", content: "Run a large command" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-large",
							name: "execute_command",
							input: { command: "print-large-output" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-large",
							content: [{ type: "text", text: longToolOutput }],
						},
					],
				},
				{ role: "assistant", content: "Observed large output" },
				{ role: "user", content: "Latest request" },
				{ role: "assistant", content: "Latest answer" },
			],
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 10 },
			},
		});

		expect(createMessage).toHaveBeenCalledTimes(1);
		const createMessageCalls = createMessage.mock.calls as unknown as [
			string,
			Array<{ role: string; content: string }>,
		][];
		const summarizerMessages = createMessageCalls[0]?.[1];
		const summarizerPrompt = summarizerMessages?.[0]?.content ?? "";
		expect(summarizerPrompt).toContain("[Tool result]");
		expect(summarizerPrompt).toContain("...[truncated ");
		expect(summarizerPrompt).not.toContain(omittedTail);
		expect(summarizerPrompt.length).toBeLessThan(longToolOutput.length);
	});

	it("never lands the agentic cut in the middle of a tool pair", async () => {
		// Repro for the "No tool call found for function call output" provider
		// error: findCutIndex used to walk back by token budget and could land
		// between an assistant tool_use and its matching user tool_result,
		// leaving the tool_result in the preserved tail while the tool_use was
		// folded into the summary.
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(() =>
				streamChunks([
					{
						type: "text",
						id: "summary-pair",
						text: "## Goal\nDescribed earlier work\n\n## Next\nContinue",
					},
					{ type: "done", id: "summary-pair", success: true },
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
				// A tiny preserve budget so findCutIndex's natural candidate
				// would land at the most recent message (the tool_result),
				// splitting the pair before the snap-to-turn-start fix.
				preserveRecentTokens: 1,
				reserveTokens: 5,
			},
			logger: undefined,
		});

		const heavyToolOutput = "x".repeat(1_500);
		const sharedMessages = [
			{ role: "user" as const, content: "Old turn to summarize" },
			{ role: "assistant" as const, content: "Old reply" },
			{ role: "user" as const, content: "Read the file" },
			{
				role: "assistant" as const,
				content: [
					{
						type: "tool_use" as const,
						id: "tool-pair",
						name: "read_files",
						input: { file_paths: ["/tmp/x.ts"] },
					},
				],
			},
			{
				role: "user" as const,
				content: [
					{
						type: "tool_result" as const,
						tool_use_id: "tool-pair",
						content: heavyToolOutput,
					},
				],
			},
			{ role: "user" as const, content: "Now do the next thing" },
		];

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages: sharedMessages,
			apiMessages: sharedMessages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 10 },
			},
		});

		expect(result?.messages).toBeDefined();
		const messages = result?.messages ?? [];
		const toolUseIds = new Set<string>();
		const toolResultIds = new Set<string>();
		for (const msg of messages) {
			if (!Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block.type === "tool_use") toolUseIds.add(block.id);
				if (block.type === "tool_result") toolResultIds.add(block.tool_use_id);
			}
		}
		// Either both halves of the pair are in the preserved tail, or both
		// are folded into the summary. Never one without the other.
		for (const id of toolUseIds) {
			expect(toolResultIds.has(id)).toBe(true);
		}
		for (const id of toolResultIds) {
			expect(toolUseIds.has(id)).toBe(true);
		}
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
				info: { id: "primary-model", maxInputTokens: 10 },
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
				info: { id: "mock-model", maxInputTokens: 10 },
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

	it("uses the default reserve when no trigger is configured", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted by reserve" }],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, compact },
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
				{ role: "user", content: "x".repeat(340) },
				{ role: "assistant", content: "y".repeat(340) },
			],
			apiMessages: [
				{ role: "user", content: "x".repeat(340) },
				{ role: "assistant", content: "y".repeat(340) },
			],
			model: {
				id: "mock-model",
				provider: "openai-codex",
				info: { id: "mock-model", maxInputTokens: 200 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.triggerTokens).toBe(0);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted by reserve" },
		]);
	});

	it("caps the default trigger at 90 percent of the context window", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted by ratio" }],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-codex",
			modelId: "gpt-5.4-mini",
			providerConfig: {
				providerId: "openai-codex",
				modelId: "gpt-5.4-mini",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, compact },
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
				{ role: "user", content: "x".repeat(365_000) },
				{ role: "assistant", content: "y".repeat(365_000) },
			],
			apiMessages: [
				{ role: "user", content: "x".repeat(365_000) },
				{ role: "assistant", content: "y".repeat(365_000) },
			],
			model: {
				id: "gpt-5.4-mini",
				provider: "openai-codex",
				info: { id: "gpt-5.4-mini", maxInputTokens: 200_000 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.triggerTokens).toBe(180_000);
		expect(context?.thresholdRatio).toBe(0.9);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted by ratio" },
		]);
	});

	it("triggers compaction from provider-sized tool result payloads", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [
				{ role: "user" as const, content: "Compacted provider payload" },
			],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-codex",
			modelId: "gpt-5.4-mini",
			providerConfig: {
				providerId: "openai-codex",
				modelId: "gpt-5.4-mini",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, compact },
			logger: undefined,
		});
		const largeToolResult = "x".repeat(800_000);
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Read a large file" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-large",
						name: "read_files",
						input: { file_paths: ["/tmp/large.txt"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-large",
						content: [{ type: "text", text: largeToolResult }],
					},
				],
			},
		];

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "gpt-5.4-mini",
				provider: "openai-codex",
				info: { id: "gpt-5.4-mini", maxInputTokens: 272_000 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.triggerTokens).toBe(244_800);
		expect(context?.utilizationRatio).toBeGreaterThan(0.9);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted provider payload" },
		]);
	});

	it("honors an explicit threshold ratio when reserveTokens is not configured", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted explicitly" }],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, thresholdRatio: 0.95, compact },
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
				info: { id: "mock-model", maxInputTokens: 100 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(compact).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("manual mode forces compaction below the auto threshold", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted manually" }],
		}));
		const prepareTurn = createContextCompactionPrepareTurn(
			{
				providerId: "anthropic",
				modelId: "mock-model",
				providerConfig: {
					providerId: "anthropic",
					modelId: "mock-model",
				} as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					thresholdRatio: 0.95,
					compact,
				},
				logger: undefined,
			},
			{ mode: "manual" },
		);

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
				info: { id: "mock-model", maxInputTokens: 100 },
			},
		});

		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.maxInputTokens).toBe(100);
		expect(context?.triggerTokens).toBeLessThan(95);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted manually" },
		]);
	});

	it("manual mode lowers the agentic preserve budget below the default floor", async () => {
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(() =>
				streamChunks([
					{
						type: "text",
						id: "summary-manual",
						text: "## Goal\nManual compact\n\n## Next\nContinue",
					},
					{ type: "done", id: "summary-manual", success: true },
				]),
			),
		});
		const repeatedText = "manual compact content ".repeat(100);
		const prepareTurn = createContextCompactionPrepareTurn(
			{
				providerId: "anthropic",
				modelId: "mock-model",
				providerConfig: {
					providerId: "anthropic",
					modelId: "mock-model",
				} as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "agentic",
				},
				logger: undefined,
			},
			{ mode: "manual" },
		);

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages: [
				{ role: "user", content: `Old request ${repeatedText}` },
				{ role: "assistant", content: `Old reply ${repeatedText}` },
				{ role: "user", content: `Latest request ${repeatedText}` },
				{ role: "assistant", content: `Latest reply ${repeatedText}` },
			],
			apiMessages: [
				{ role: "user", content: `Old request ${repeatedText}` },
				{ role: "assistant", content: `Old reply ${repeatedText}` },
				{ role: "user", content: `Latest request ${repeatedText}` },
				{ role: "assistant", content: `Latest reply ${repeatedText}` },
			],
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 10_000 },
			},
		});

		expect(createHandlerMock).toHaveBeenCalledTimes(1);
		expect(result?.messages[0]).toMatchObject({
			role: "user",
			metadata: expect.objectContaining({
				kind: "compaction_summary",
			}),
		});
		expect(result?.messages.length).toBeLessThan(4);
	});

	it("preserves user image blocks during basic compaction sanitization", () => {
		const messages: LlmsProviders.Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "  Older user turn  " },
					{ type: "image", data: "abc", mediaType: "image/png" },
				],
			},
			{ role: "assistant", content: "Older assistant response" },
			{ role: "user", content: "Latest user turn" },
		];

		const result = runBasicCompaction({
			context: {
				agentId: "agent-1",
				conversationId: "conv-1",
				parentAgentId: null,
				iteration: 1,
				messages,
				model: {
					id: "mock-model",
					provider: "anthropic",
					info: { id: "mock-model", maxInputTokens: 100 },
				},
				maxInputTokens: 100,
				triggerTokens: 100,
				thresholdRatio: 1,
				utilizationRatio: 0.1,
			},
			estimateMessageTokens: createTokenEstimator(),
		});

		expect(result?.messages).toBeDefined();
		expect(result?.messages[0]?.content).toEqual([
			{ type: "text", text: "Older user turn" },
			{ type: "image", data: "abc", mediaType: "image/png" },
		]);
		expect(result?.messages.at(-1)).toEqual({
			role: "user",
			content: "Latest user turn",
		});
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
				info: { id: "mock-model", maxInputTokens: 100 },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});
});
