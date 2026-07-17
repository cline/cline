import type * as LlmsProviders from "@cline/llms";
import {
	estimateRequestInputTokens,
	type MessageWithMetadata,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCompactionState } from "../../session/models/session-compaction";
import type { CoreCompactionContext } from "../../types/config";
import { buildAgenticSummaryInputBudget } from "./agentic-compaction";
import { runBasicCompaction } from "./basic-compaction";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";
import {
	createTokenEstimator,
	estimateTokens,
	resolveEffectiveMaxInputTokens,
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

describe("createTokenEstimator", () => {
	it("does not treat cumulative request metrics as per-message token counts", () => {
		const estimateMessageTokens = createTokenEstimator();
		const message: MessageWithMetadata = {
			role: "assistant",
			content: "short",
			metrics: {
				inputTokens: 100,
				cacheReadTokens: 80,
				outputTokens: 7,
			},
		};

		expect(estimateMessageTokens(message)).toBe(
			Math.ceil(JSON.stringify(message).length / 3),
		);
	});

	it("falls back to serialized character estimation when metrics are incomplete", () => {
		const estimateMessageTokens = createTokenEstimator();
		const message: MessageWithMetadata = {
			role: "assistant",
			content: "short",
			metrics: {
				inputTokens: 12,
			},
		};

		expect(estimateMessageTokens(message)).toBe(
			Math.ceil(JSON.stringify(message).length / 3),
		);
	});
});

describe("resolveEffectiveMaxInputTokens", () => {
	it("uses maxInputTokens when it differs from contextWindow", () => {
		expect(
			resolveEffectiveMaxInputTokens({
				maxInputTokens: 200_000,
				contextWindow: 400_000,
			}),
		).toBe(200_000);
	});

	it("caps maxInputTokens at contextWindow", () => {
		expect(
			resolveEffectiveMaxInputTokens({
				maxInputTokens: 500_000,
				contextWindow: 400_000,
			}),
		).toBe(400_000);
	});

	it("keeps maxInputTokens authoritative when it equals contextWindow", () => {
		expect(
			resolveEffectiveMaxInputTokens({
				maxInputTokens: 400_000,
				contextWindow: 400_000,
			}),
		).toBe(400_000);
	});

	it("uses 90 percent of contextWindow when maxTokens is unavailable", () => {
		expect(
			resolveEffectiveMaxInputTokens({
				contextWindow: 400_000,
			}),
		).toBe(360_000);
	});

	it("does not reserve catalog maxTokens when only contextWindow is available", () => {
		const modelInfo = {
			contextWindow: 400_000,
			maxTokens: 128_000,
		};
		expect(resolveEffectiveMaxInputTokens(modelInfo)).toBe(360_000);
	});

	it("keeps maxInputTokens when maxTokens would leave no input budget", () => {
		const modelInfo = {
			maxInputTokens: 200_000,
			contextWindow: 200_000,
			maxTokens: 200_000,
		};
		expect(resolveEffectiveMaxInputTokens(modelInfo)).toBe(200_000);
	});
});

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
			mode: "manual",
			budget: {
				request: {
					inputTokens: targetTokens * 2,
					maxInputTokens: targetTokens,
					triggerTokens: targetTokens,
					targetTokens,
					overheadTokens: 0,
					thresholdRatio: 1,
					utilizationRatio: 2,
				},
				messages: {
					inputTokens: targetTokens * 2,
					triggerTokens: targetTokens,
					targetTokens,
				},
			},
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
				name: "read_files",
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
					name: "tool",
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
					name: "tool",
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

	it("returns no result when the transcript has no typed user prompt", () => {
		// The whole-history fold anchors on typed user prompts; a transcript
		// of pure tool traffic has nothing to fold around.
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
								name: "tool",
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
				mode: "manual",
				budget: {
					request: {
						inputTokens: 10_000,
						maxInputTokens: 100_000,
						triggerTokens: 100_000,
						targetTokens: 100_000,
						overheadTokens: 0,
						thresholdRatio: 1,
						utilizationRatio: 0.1,
					},
					messages: {
						inputTokens: 10_000,
						triggerTokens: 100_000,
						targetTokens: 100_000,
					},
				},
			},
			estimateMessageTokens: createTokenEstimator(),
		});

		expect(result).toBeUndefined();
	});

	it("drops the latest turn's tool pair atomically when over budget", () => {
		// The whole history is compactable — there is no protected latest
		// turn. A fresh tool pair that does not fit the budget is removed
		// with both halves together, never split.
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Read the file" },
			assistantToolUseMessage("tool-a"),
			toolResultMessage("tool-a", "a".repeat(1_000)),
		];
		const targetTokens =
			totalJsonTokens(messages) - estimateJsonTokens(messages[2]) + 10;

		const compacted = runForcedBasicCompaction(messages, targetTokens);

		expectNoOrphanedToolPairs(compacted);
		expect(collectToolPairPresence(compacted).get("tool-a")).toBeUndefined();
		expect(compacted).toEqual([
			{
				role: "user",
				content: "Read the file",
				metadata: {
					kind: "compaction",
					reason: "manual_compaction",
					displayRole: "system",
					messagesRemoved: 2,
				},
			},
		]);
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
		expect(JSON.stringify(compacted)).toContain("Read the latest file");
	});

	it("may drop the latest completed tool pair under aggressive basic compaction", () => {
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
		expect(pairs.get("tool-b")).toBeUndefined();
		expect(JSON.stringify(compacted)).toContain("Read the latest file");
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

	it("preserves the latest typed user prompt without requiring completed tool work", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Old request" },
			{ role: "assistant", content: "Old answer that can be compacted" },
			{ role: "user", content: "Read the latest file" },
			assistantToolUseMessage("tool-a"),
			toolResultMessage("tool-a", "latest result"),
		];

		const compacted = runForcedBasicCompaction(messages, 1);

		// Adjacent typed user messages left behind by the removals merge
		// into a single user message carrying the compaction metadata.
		expect(compacted).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "Old request" },
					{ type: "text", text: "Read the latest file" },
				],
				metadata: {
					kind: "compaction",
					reason: "manual_compaction",
					displayRole: "system",
					messagesRemoved: 4,
				},
			},
		]);
		expectNoOrphanedToolPairs(compacted);
	});

	it("bridges merged user turns with dropped-work summaries and drops stale metrics", () => {
		const grepCommand =
			'grep -rn "sidebarItem\\|sidebarText\\|sidebar:\\|variant" /repo/webview/components/ui/button.tsx --include "*.tsx" --color=never';
		const editorDiff = JSON.stringify({
			query: "edit:/repo/webview/components/agent-sidebar.tsx",
			result:
				"Edited /repo/webview/components/agent-sidebar.tsx\n```diff\n-467: \told\n+467: \tnew\n-479: \tolder\n+479: \tnewer\n```",
		});
		const messages: MessageWithMetadata[] = [
			{
				id: "u1",
				role: "user",
				content: [
					{ type: "text", text: "request one" },
					{
						type: "file",
						path: "/repo/webview/components/agent-sidebar.tsx",
						content: "x".repeat(5_000),
					},
				],
			},
			{
				id: "a1",
				role: "assistant",
				metrics: { inputTokens: 100, outputTokens: 10, cost: 0.25 },
				content: [
					{
						type: "tool_use",
						id: "tool-edit",
						name: "editor",
						input: {
							path: "/repo/webview/components/agent-sidebar.tsx",
							old_text: "a",
							new_text: "b",
						},
					},
				],
			},
			{
				id: "t1",
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-edit",
						name: "editor",
						content: editorDiff,
					},
				],
			},
			{
				id: "a2",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-read",
						name: "read_files",
						input: {
							files: [
								{
									path: "/repo/webview/components/agent-sidebar.tsx",
									start_line: 462,
									end_line: 480,
								},
							],
						},
					},
				],
			},
			{
				id: "t2",
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-read",
						name: "read_files",
						content: "462 | ...",
					},
				],
			},
			{ id: "a3", role: "assistant", content: "Done with the first request." },
			{
				id: "u2",
				role: "user",
				content: [{ type: "text", text: "request two" }],
			},
			{
				id: "a4",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-grep",
						name: "run_commands",
						input: { commands: [grepCommand] },
					},
				],
			},
			{
				id: "t3",
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-grep",
						name: "run_commands",
						content: "button.tsx:12: ...",
					},
				],
			},
			{ id: "a5", role: "assistant", content: "Done with the second request." },
			{
				id: "u3",
				role: "user",
				content: [{ type: "text", text: "request three" }],
			},
			{
				id: "a6",
				role: "assistant",
				metrics: {
					inputTokens: 500,
					outputTokens: 20,
					cacheReadTokens: 400,
					cacheWriteTokens: 0,
					cost: 0.5,
				},
				content: "Final answer for request three.",
			},
		];
		// The fold is unconditional; the budget only needs enough room that
		// the projection safety valve does not trim the typed prompts.
		const targetTokens =
			estimateJsonTokens(messages[0]) +
			estimateJsonTokens(messages[6]) +
			estimateJsonTokens(messages[10]) +
			40;

		const compacted = runForcedBasicCompaction(
			messages,
			targetTokens,
		) as MessageWithMetadata[];

		// Everything folds into a single user message — the final assistant
		// answer survives inside the trailing summary block.
		expect(compacted).toHaveLength(1);
		const merged = compacted[0];
		expect(merged.id).toBe("u1");
		expect(merged.role).toBe("user");
		const texts = (Array.isArray(merged.content) ? merged.content : []).map(
			(block) => (block.type === "text" ? block.text : `[${block.type}]`),
		);
		expect(texts).toHaveLength(6);
		expect(texts[0]).toBe("request one");
		expect(texts[1]).toContain("<SYSTEM_NOTICE>");
		expect(texts[1]).toContain(
			"Files read:\n/repo/webview/components/agent-sidebar.tsx:462-480",
		);
		expect(texts[1]).toContain(
			"Files edited:\n/repo/webview/components/agent-sidebar.tsx:467-479",
		);
		// The last three assistant text contents survive inside the summary
		// covering the span they were dropped from.
		expect(texts[1]).toContain(
			"Your recent responses:\nDone with the first request.",
		);
		expect(texts[2]).toBe("request two");
		expect(texts[3]).toContain("Commands ran:\ngrep -rn");
		// Long commands are truncated to 100 chars with a trailing ellipsis.
		expect(texts[3]).not.toContain("--color=never");
		expect(texts[3]).toContain("...");
		expect(texts[3]).toContain(
			"Your recent responses:\nDone with the second request.",
		);
		expect(texts[4]).toBe("request three");
		expect(texts[5]).toContain(
			"Your recent responses:\nFinal answer for request three.",
		);
		// Stale attached file contents are dropped from merged turns.
		expect(JSON.stringify(compacted)).not.toContain('"type":"file"');
		// Token metrics no longer add up after compaction and are dropped;
		// the aggregate survives on the compaction message's metadata.
		expect(JSON.stringify(compacted)).not.toContain('"metrics"');
		expect(merged.metadata).toEqual({
			kind: "compaction",
			reason: "manual_compaction",
			displayRole: "system",
			messagesRemoved: 11,
			usageBefore: {
				inputTokens: 600,
				outputTokens: 30,
				cacheReadTokens: 400,
				cacheWriteTokens: 0,
				cost: 0.75,
			},
		});
	});

	it("budgets the complete basic compaction output including the latest turn", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "original task" },
			{ role: "assistant", content: "old assistant " + "x".repeat(10_000) },
			{ role: "user", content: "latest typed prompt" },
			assistantToolUseMessage("tool-live"),
			toolResultMessage("tool-live", "live result " + "y".repeat(10_000)),
		];

		const compacted = runForcedBasicCompaction(messages, 700);

		expect(totalJsonTokens(compacted)).toBeLessThanOrEqual(700);
		expect(JSON.stringify(compacted)).toContain("latest typed prompt");
		expectNoOrphanedToolPairs(compacted);
	});

	it("does not compact a single typed user message", () => {
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Only current request" },
		];

		const compacted = runForcedBasicCompaction(messages, 1);

		expect(compacted).toBe(messages);
	});

	it("does not truncate a shallow first task prompt below the trigger for high-output models", async () => {
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openrouter",
			modelId: "minimax/minimax-m3",
			providerConfig: {
				providerId: "openrouter",
				modelId: "minimax/minimax-m3",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "basic",
			},
			logger: undefined,
		});
		const task =
			'<user_input mode="act">Create /app/filter.py that removes JavaScript from HTML files. ' +
			"Keep this task prompt intact. ".repeat(25) +
			"</user_input>";
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: task },
			{ role: "assistant", content: "old assistant context ".repeat(500) },
			{ role: "user", content: "Continue" },
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
				id: "minimax/minimax-m3",
				provider: "openrouter",
				info: {
					id: "minimax/minimax-m3",
					maxInputTokens: 1_000,
					maxTokens: 950,
				},
			},
		});

		// The task prompt and the follow-up merge into one user message; the
		// task text itself must survive verbatim, not truncated.
		const firstContent = result?.messages?.[0]?.content;
		const firstText =
			Array.isArray(firstContent) && firstContent[0]?.type === "text"
				? firstContent[0].text
				: firstContent;
		expect(firstText).toBe(task);
		expect(JSON.stringify(result?.messages)).toContain("Create /app/filter.py");
		expect(JSON.stringify(result?.messages)).not.toContain("<user_input\n...");
	});

	it("can truncate an oversized first task prompt when it exceeds the trigger", () => {
		const oversizedPrompt = "<user_input>".repeat(500);
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: oversizedPrompt },
			{ role: "assistant", content: "old assistant context ".repeat(500) },
			{ role: "user", content: "current turn" },
		];

		const compacted = runBasicCompaction({
			context: {
				agentId: "agent-1",
				conversationId: "conv-1",
				parentAgentId: null,
				iteration: 1,
				messages,
				model: {
					id: "mock-model",
					provider: "openrouter",
					info: { id: "mock-model", maxInputTokens: 1_000 },
				},
				mode: "manual",
				budget: {
					request: {
						inputTokens: 2_000,
						maxInputTokens: 1_000,
						triggerTokens: 900,
						targetTokens: 100,
						overheadTokens: 0,
						thresholdRatio: 0.9,
						utilizationRatio: 2,
					},
					messages: {
						inputTokens: 2_000,
						triggerTokens: 900,
						targetTokens: 100,
					},
				},
			},
			estimateMessageTokens: estimateJsonTokens,
		});

		expect(compacted?.messages[0]?.content).not.toBe(oversizedPrompt);
		const mergedContent = compacted?.messages[0]?.content;
		const mergedText = Array.isArray(mergedContent)
			? mergedContent
					.map((block) => (block.type === "text" ? block.text : ""))
					.join("\n")
			: String(mergedContent);
		expect(mergedText).toContain("\n...");
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

	it("preserves summarizer modelInfo without a nested providerConfig", () => {
		const resolved = resolveSummarizerConfig({
			activeProviderConfig: {
				providerId: "anthropic",
				modelId: "primary-model",
				modelInfo: { id: "primary-model", maxInputTokens: 100_000 },
			} as LlmsProviders.ProviderConfig,
			summarizer: {
				providerId: "openai",
				modelId: "small-summary",
				modelInfo: { id: "small-summary", maxInputTokens: 600 },
			},
		});

		expect(resolved.modelInfo?.maxInputTokens).toBe(600);
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
							name: "tool",
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
							name: "tool",
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
		expect(result?.messages[0]?.content).toEqual([
			expect.objectContaining({ type: "text" }),
		]);
		const summaryContent = Array.isArray(result?.messages[0]?.content)
			? result.messages[0].content[0]?.type === "text"
				? result.messages[0].content[0].text
				: ""
			: "";
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
							name: "tool",
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
							name: "tool",
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

	it("budgets agentic summary input before serialization", () => {
		const result = buildAgenticSummaryInputBudget({
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
							name: "execute_command",
							content: "x".repeat(50_000),
						},
					],
				},
				{ role: "user", content: "Latest typed prompt" },
			],
			targetTokens: 400,
			estimateMessageTokens: estimateJsonTokens,
		});

		expect(result.estimatedTokens).toBeLessThanOrEqual(400);
		expect(JSON.stringify(result.messages)).toContain("Latest typed prompt");
		expect(result.actions.length).toBeGreaterThan(0);
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
						name: "tool",
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

	it("compacts a single-task tool loop by cutting at an assistant boundary", async () => {
		// Repro for agentic auto-compaction permanently skipping in hosts like
		// the VS Code extension: the canonical transcript is one typed task
		// message followed by a long assistant tool_use / user tool_result
		// loop. findCutIndex used to accept only typed-user turn starts as cut
		// boundaries, so the snap always walked back to index 0 and
		// runAgenticCompaction returned undefined ("auto-compaction-skipped")
		// on every turn. Assistant messages are equally safe boundaries: a
		// tool_use keeps its result in the user message that follows it.
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(() =>
				streamChunks([
					{
						type: "text",
						id: "summary-loop",
						text: "## Goal\nBuild the feature\n\n## Next\nContinue",
					},
					{ type: "done", id: "summary-loop", success: true },
				]),
			),
		});

		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "<task>Build the feature</task>" },
		];
		for (let i = 0; i < 12; i++) {
			messages.push({
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: `loop-tool-${i}`,
						name: "read_files",
						input: { file_paths: [`/tmp/f${i}.ts`] },
					},
				],
			});
			messages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: `loop-tool-${i}`,
						name: "read_files",
						content: "x".repeat(1_500),
					},
				],
			});
		}
		messages.push({ role: "assistant", content: "working on it" });

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
				strategy: "agentic",
				preserveRecentTokens: 1_000,
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
			messages,
			apiMessages: messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 4_000 },
			},
		});

		expect(emitStatusNotice).toHaveBeenCalledWith(
			"auto-compacted",
			expect.objectContaining({ kind: "auto_compaction" }),
		);
		expect(result?.messages[0]).toMatchObject({
			role: "user",
			metadata: expect.objectContaining({ kind: "compaction_summary" }),
		});
		expect(result?.messages.length).toBeLessThan(messages.length);
		// The preserved tail must not orphan either half of a tool pair.
		const toolUseIds2 = new Set<string>();
		const toolResultIds2 = new Set<string>();
		for (const msg of result?.messages ?? []) {
			if (!Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block.type === "tool_use") toolUseIds2.add(block.id);
				if (block.type === "tool_result") {
					toolResultIds2.add(block.tool_use_id);
				}
			}
		}
		for (const id of toolUseIds2) {
			expect(toolResultIds2.has(id)).toBe(true);
		}
		for (const id of toolResultIds2) {
			expect(toolUseIds2.has(id)).toBe(true);
		}
	});

	it("re-compacts a projection that starts with a compaction summary", async () => {
		// After a successful compaction, the state-aware wrapper re-runs the
		// strategy on [summary message, ...preserved tail]. The summary is not
		// a typed turn start, so the old boundary rule made every follow-up
		// auto-compaction skip while the tail kept growing.
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(() =>
				streamChunks([
					{
						type: "text",
						id: "summary-refold",
						text: "## Goal\nStill building\n\n## Next\nContinue",
					},
					{ type: "done", id: "summary-refold", success: true },
				]),
			),
		});

		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Context summary:\n\nearlier work" }],
				metadata: {
					kind: "compaction_summary",
					summary: "earlier work",
					details: { readFiles: [], modifiedFiles: [] },
					tokensBefore: 100,
					generatedAt: 1,
				},
			},
		];
		for (let i = 0; i < 12; i++) {
			messages.push({
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: `refold-tool-${i}`,
						name: "read_files",
						input: { file_paths: [`/tmp/g${i}.ts`] },
					},
				],
			});
			messages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: `refold-tool-${i}`,
						name: "read_files",
						content: "y".repeat(1_500),
					},
				],
			});
		}

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
				strategy: "agentic",
				preserveRecentTokens: 1_000,
			},
			logger: undefined,
		});

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 2,
			abortSignal: new AbortController().signal,
			emitStatusNotice,
			systemPrompt: "You are helpful.",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 4_000 },
			},
		});

		expect(emitStatusNotice).toHaveBeenCalledWith(
			"auto-compacted",
			expect.objectContaining({ kind: "auto_compaction" }),
		);
		expect(result?.messages[0]).toMatchObject({
			role: "user",
			metadata: expect.objectContaining({ kind: "compaction_summary" }),
		});
		expect(result?.messages.length).toBeLessThan(messages.length);
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

	it("budgets agentic summary input against the configured summarizer context window", async () => {
		let summaryRequest = "";
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(
				(_system: string, messages: LlmsProviders.Message[]) => {
					summaryRequest = String(messages[0]?.content ?? "");
					return streamChunks([
						{ type: "text", id: "summary-small", text: "## Goal\nSummarized" },
						{ type: "done", id: "summary-small", success: true },
					]);
				},
			),
		});

		const summarizerLimit = 600;
		const oversizedAssistant = "assistant details ".repeat(5_000);
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "primary-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "primary-model",
				modelInfo: { id: "primary-model", maxInputTokens: 10_000 },
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
				summarizer: {
					providerId: "openai",
					modelId: "small-summary",
					modelInfo: {
						id: "small-summary",
						maxInputTokens: summarizerLimit,
					},
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
				{ role: "user", content: "Old request" },
				{ role: "assistant", content: oversizedAssistant },
				{ role: "user", content: "Latest turn" },
				{ role: "assistant", content: "Latest answer" },
			],
			apiMessages: [
				{ role: "user", content: "Old request" },
				{ role: "assistant", content: oversizedAssistant },
				{ role: "user", content: "Latest turn" },
				{ role: "assistant", content: "Latest answer" },
			],
			model: {
				id: "primary-model",
				provider: "anthropic",
				info: { id: "primary-model", maxInputTokens: 10_000 },
			},
		});

		expect(createHandlerMock).toHaveBeenCalledTimes(1);
		expect(estimateTokens(summaryRequest.length)).toBeLessThanOrEqual(
			summarizerLimit,
		);
		expect(summaryRequest).not.toContain(oversizedAssistant);
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
							name: "tool",
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
							name: "tool",
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

	it("triggers compaction when input reaches exactly 90 percent", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted at 90%" }],
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

		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "At the exact compaction boundary" },
		];
		const inputTokens = estimateRequestInputTokens({
			systemPrompt: "You are helpful.",
			messages,
			tools: [],
		});
		const maxInputTokens = inputTokens / 0.9;
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
				id: "mock-model",
				provider: "openai-codex",
				info: { id: "mock-model", maxInputTokens },
			},
		});

		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.budget.request.triggerTokens).toBe(inputTokens);
		expect(context?.budget.request.thresholdRatio).toBe(0.9);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted at 90%" },
		]);
	});

	it("triggers at 81 percent when only contextWindow is available", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted at 81%" }],
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
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "At the context fallback boundary" },
		];
		const inputTokens = estimateRequestInputTokens({
			systemPrompt: "You are helpful.",
			messages,
			tools: [],
		});
		const contextWindow = inputTokens / 0.81;

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
				id: "mock-model",
				provider: "anthropic",
				info: {
					id: "mock-model",
					contextWindow,
				},
			},
		});

		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.budget.request.maxInputTokens).toBeCloseTo(
			contextWindow * 0.9,
		);
		expect(context?.budget.request.triggerTokens).toBeCloseTo(inputTokens);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted at 81%" },
		]);
	});

	it("includes system prompt and tools in the automatic trigger", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted full request" }],
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
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "small message" },
		];
		const systemPrompt = "s".repeat(3_000);
		const tools = [
			{
				name: "large_tool",
				description: "t".repeat(3_000),
				inputSchema: { type: "object" },
			},
		];

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt,
			tools,
			messages,
			apiMessages: messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 2_000 },
			},
		});

		expect(createTokenEstimator()(messages[0])).toBeLessThan(1_800);
		expect(
			estimateRequestInputTokens({ systemPrompt, messages, tools }),
		).toBeGreaterThanOrEqual(1_800);
		expect(compact).toHaveBeenCalledTimes(1);
	});

	it("translates full-request targets into attainable message budgets", async () => {
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: `old request ${"u".repeat(800)}` },
			{ role: "assistant", content: `old answer ${"a".repeat(800)}` },
			{ role: "user", content: `latest request ${"l".repeat(800)}` },
		];
		const systemPrompt = "s".repeat(4_000);
		const requestInputTokens = estimateRequestInputTokens({
			systemPrompt,
			messages,
			tools: [],
		});
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, strategy: "basic" },
			logger: undefined,
		});

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt,
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: {
					id: "mock-model",
					maxInputTokens: requestInputTokens / 0.91,
				},
			},
		});

		expect(result?.messages).toBeDefined();
		expect(result?.messages).not.toEqual(messages);
	});

	it("triggers at 90 percent of maxInputTokens", async () => {
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
		expect(context?.budget.request.triggerTokens).toBe(180_000);
		expect(context?.budget.request.thresholdRatio).toBe(0.9);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted by ratio" },
		]);
	});

	it("does not subtract maxTokens when maxInputTokens differs from contextWindow", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [
				{ role: "user" as const, content: "Compacted by input budget" },
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
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: "large prompt ".repeat(20_000),
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
				info: {
					id: "gpt-5.4-mini",
					contextWindow: 400_000,
					maxInputTokens: 200_000,
					maxTokens: 128_000,
				},
			},
		});

		expect(compact).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("targets basic compaction at half the input budget for long conversations", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [
				{ role: "user" as const, content: "Compacted by target budget" },
			],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			providerConfig: {
				providerId: "openai-codex",
				modelId: "gpt-5.5",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, strategy: "basic", compact },
			logger: undefined,
		});
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "turn 1" },
			{ role: "assistant", content: "answer 1" },
			{ role: "user", content: "turn 2" },
			{ role: "assistant", content: "answer 2" },
			{ role: "user", content: "turn 3" },
			{ role: "assistant", content: "answer 3" },
			{ role: "user", content: "turn 4" },
			{ role: "assistant", content: "answer 4" },
			{ role: "user", content: "turn 5" },
			{ role: "assistant", content: "answer 5" },
			{ role: "user", content: "large prompt ".repeat(70_000) },
		];

		await prepareTurn?.({
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
				id: "gpt-5.5",
				provider: "openai-codex",
				info: {
					id: "gpt-5.5",
					maxInputTokens: 272_000,
					maxTokens: 128_000,
				},
			},
		});

		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.budget.request.triggerTokens).toBe(244_800);
		expect(context?.budget.request.targetTokens).toBe(136_000);
		expect(context?.budget.messages.targetTokens).toBe(
			(context?.budget.request.targetTokens ?? 0) -
				(context?.budget.request.overheadTokens ?? 0),
		);
	});

	it("keeps the long-conversation target below the fixed trigger", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [
				{ role: "user" as const, content: "Compacted by low threshold" },
			],
		}));
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
				compact,
			},
			logger: undefined,
		});
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "turn 1" },
			{ role: "assistant", content: "answer 1" },
			{ role: "user", content: "turn 2" },
			{ role: "assistant", content: "answer 2" },
			{ role: "user", content: "turn 3" },
			{ role: "assistant", content: "answer 3" },
			{ role: "user", content: "turn 4" },
			{ role: "assistant", content: "answer 4" },
			{ role: "user", content: "turn 5" },
			{ role: "assistant", content: "answer 5" },
			{ role: "user", content: "large prompt ".repeat(20) },
		];

		await prepareTurn?.({
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
				id: "mock-model",
				provider: "anthropic",
				info: {
					id: "mock-model",
					maxInputTokens: 100,
					maxTokens: 20,
				},
			},
		});

		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.budget.request.triggerTokens).toBe(90);
		expect(context?.budget.request.targetTokens).toBe(50);
		expect(context?.budget.messages.targetTokens).toBe(
			Math.max(
				1,
				(context?.budget.request.targetTokens ?? 0) -
					(context?.budget.request.overheadTokens ?? 0),
			),
		);
	});

	it("uses a conservative input budget when only contextWindow is reported", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [
				{ role: "user" as const, content: "Compacted by derived input budget" },
			],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			providerConfig: {
				providerId: "openai-codex",
				modelId: "gpt-5.5",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, compact },
			logger: undefined,
		});
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: "large prompt ".repeat(80_000),
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
				id: "gpt-5.5",
				provider: "openai-codex",
				info: {
					id: "gpt-5.5",
					contextWindow: 400_000,
					maxTokens: 128_000,
				},
			},
		});

		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.budget.request.maxInputTokens).toBe(360_000);
		expect(context?.budget.request.triggerTokens).toBe(324_000);
		expect(context?.budget.request.thresholdRatio).toBe(0.9);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted by derived input budget" },
		]);
	});

	it("uses the lower split input budget when it is below context-derived input budget", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [
				{ role: "user" as const, content: "Compacted by split input" },
			],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			providerConfig: {
				providerId: "openai-codex",
				modelId: "gpt-5.5",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, compact },
			logger: undefined,
		});
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: "large prompt ".repeat(60_000),
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
				id: "gpt-5.5",
				provider: "openai-codex",
				info: {
					id: "gpt-5.5",
					contextWindow: 400_000,
					maxInputTokens: 200_000,
					maxTokens: 128_000,
				},
			},
		});

		expect(compact).toHaveBeenCalledTimes(1);
		const context = compact.mock.calls[0]?.[0];
		expect(context?.budget.request.maxInputTokens).toBe(200_000);
		expect(context?.budget.request.triggerTokens).toBe(180_000);
		expect(context?.budget.request.thresholdRatio).toBe(0.9);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted by split input" },
		]);
	});

	it("uses contextWindow when maxTokens leaves no input budget", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted by fallback" }],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-codex",
			modelId: "large-output-model",
			providerConfig: {
				providerId: "openai-codex",
				modelId: "large-output-model",
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
			messages: [{ role: "user", content: "small prompt" }],
			apiMessages: [{ role: "user", content: "small prompt" }],
			model: {
				id: "large-output-model",
				provider: "openai-codex",
				info: {
					id: "large-output-model",
					maxInputTokens: 200_000,
					contextWindow: 200_000,
					maxTokens: 200_000,
				},
			},
		});

		expect(compact).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("does not compact early when maxInputTokens equals contextWindow", async () => {
		const compact = vi.fn((_context: CoreCompactionContext) => ({
			messages: [{ role: "user" as const, content: "Compacted by fallback" }],
		}));
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openrouter",
			modelId: "minimax/minimax-m3",
			providerConfig: {
				providerId: "openrouter",
				modelId: "minimax/minimax-m3",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, strategy: "basic", compact },
			logger: undefined,
		});
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: "regex prompt ".repeat(3_000),
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
				id: "minimax/minimax-m3",
				provider: "openrouter",
				info: {
					id: "minimax/minimax-m3",
					contextWindow: 524_288,
					maxInputTokens: 524_288,
					maxTokens: 512_000,
				},
			},
		});

		expect(compact).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
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
						name: "tool",
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
		expect(context?.budget.request.triggerTokens).toBe(244_800);
		expect(context?.budget.request.utilizationRatio).toBeGreaterThan(0.9);
		expect(result?.messages).toEqual([
			{ role: "user", content: "Compacted provider payload" },
		]);
	});

	it("does not compact below the fixed 90 percent threshold", async () => {
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
		expect(context?.budget.request.maxInputTokens).toBe(100);
		expect(context?.budget.request.triggerTokens).toBe(90);
		expect(context?.budget.messages.targetTokens).toBeLessThan(
			context?.budget.messages.triggerTokens ?? 0,
		);
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

	it("automatic agentic compaction clamps preservation to a small model budget", async () => {
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(() =>
				streamChunks([
					{
						type: "text",
						id: "summary-auto-small",
						text: "## Goal\nCompact a small context\n\n## Next\nContinue",
					},
					{ type: "done", id: "summary-auto-small", success: true },
				]),
			),
		});
		const repeatedText = "small model content ".repeat(100);
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: `Old request ${repeatedText}` },
			{ role: "assistant", content: `Old reply ${repeatedText}` },
			{ role: "user", content: `Latest request ${repeatedText}` },
			{ role: "assistant", content: `Latest reply ${repeatedText}` },
		];
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "small-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "small-model",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, strategy: "agentic" },
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
			messages,
			apiMessages: messages,
			model: {
				id: "small-model",
				provider: "anthropic",
				info: { id: "small-model", maxInputTokens: 2_000 },
			},
		});

		expect(createHandlerMock).toHaveBeenCalledTimes(1);
		expect(result?.messages[0]).toMatchObject({
			role: "user",
			metadata: expect.objectContaining({ kind: "compaction_summary" }),
		});
		expect(result?.messages.length).toBeLessThan(messages.length);
	});

	it("drops old user image blocks during basic compaction sanitization", () => {
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
				mode: "manual",
				budget: {
					request: {
						inputTokens: 10,
						maxInputTokens: 100,
						triggerTokens: 100,
						targetTokens: 100,
						overheadTokens: 0,
						thresholdRatio: 1,
						utilizationRatio: 0.1,
					},
					messages: {
						inputTokens: 10,
						triggerTokens: 100,
						targetTokens: 100,
					},
				},
			},
			estimateMessageTokens: createTokenEstimator(),
		});

		// The older turn's image is dropped; the merged message keeps both
		// typed texts.
		expect(result?.messages).toHaveLength(1);
		expect(result?.messages[0]?.content).toEqual([
			{ type: "text", text: "Older user turn" },
			{ type: "text", text: "Latest user turn" },
		]);
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
							name: "tool",
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
							name: "tool",
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

	// ------------------------------------------------------------------
	// Telemetry coverage — task.compaction_executed / task.compaction_skipped
	// ------------------------------------------------------------------

	it("emits task.compaction_executed telemetry after a successful basic compaction", async () => {
		const captureCalls: Array<{
			event: string;
			properties?: Record<string, unknown>;
		}> = [];
		const telemetry = {
			capture: (call: {
				event: string;
				properties?: Record<string, unknown>;
			}) => captureCalls.push(call),
			captureRequired: () => {},
			setDistinctId: () => {},
			updateCommonProperties: () => {},
			identify: () => {},
		} as unknown as Parameters<
			typeof createContextCompactionPrepareTurn
		>[0]["telemetry"];

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
			},
			telemetry,
			sessionId: "ulid-test-1",
		});

		const filler = "x".repeat(200);
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Original task" },
			{ role: "assistant", content: `Old answer ${filler}` },
			{ role: "user", content: `Older user followup ${filler}` },
			{ role: "assistant", content: `Older assistant ${filler}` },
			{ role: "user", content: "Latest user question" },
		];

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 100 },
			},
		});

		expect(result?.messages).toBeDefined();
		const executed = captureCalls.find(
			(call) => call.event === "task.compaction_executed",
		);
		expect(executed).toBeDefined();
		const props = executed?.properties as Record<string, unknown>;
		expect(props.strategy).toBe("basic");
		expect(props.mode).toBe("auto");
		expect(props.ulid).toBe("ulid-test-1");
		expect(props.provider).toBe("anthropic");
		expect(props.modelId).toBe("mock-model");
		expect(props.agentId).toBe("agent-1");
		expect(props.conversationId).toBe("conv-1");
		expect(typeof props.durationMs).toBe("number");
		expect(typeof props.tokensBefore).toBe("number");
		expect(typeof props.tokensAfter).toBe("number");
		expect(props.messagesBefore).toBe(messages.length);
		expect(typeof props.messagesAfter).toBe("number");
		expect(props.tokensSaved).toBe(
			(props.tokensBefore as number) - (props.tokensAfter as number),
		);
	});

	it("marks strategy as 'custom' when a user-supplied compact callback is used", async () => {
		const captureCalls: Array<{
			event: string;
			properties?: Record<string, unknown>;
		}> = [];
		const telemetry = {
			capture: (call: {
				event: string;
				properties?: Record<string, unknown>;
			}) => captureCalls.push(call),
			captureRequired: () => {},
			setDistinctId: () => {},
			updateCommonProperties: () => {},
			identify: () => {},
		} as unknown as Parameters<
			typeof createContextCompactionPrepareTurn
		>[0]["telemetry"];

		const customCompact = vi.fn(async () => ({
			messages: [
				{ role: "user", content: "trimmed" },
			] as LlmsProviders.Message[],
		}));

		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "mock-model",
			providerConfig: {
				providerId: "anthropic",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "basic", // ignored when `compact` is provided
				compact: customCompact,
			},
			telemetry,
		});

		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Original task" },
			{ role: "assistant", content: "x".repeat(500) },
			{ role: "user", content: "Latest" },
		];

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 2,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 100 },
			},
		});

		expect(customCompact).toHaveBeenCalledTimes(1);
		const executed = captureCalls.find(
			(call) => call.event === "task.compaction_executed",
		);
		expect(executed).toBeDefined();
		expect((executed?.properties as Record<string, unknown>).strategy).toBe(
			"custom",
		);
	});

	it("reports executed compaction telemetry in full-request token units", async () => {
		const captureCalls: Array<{
			event: string;
			properties?: Record<string, unknown>;
		}> = [];
		const telemetry = {
			capture: (call: {
				event: string;
				properties?: Record<string, unknown>;
			}) => captureCalls.push(call),
			captureRequired: () => {},
			setDistinctId: () => {},
			updateCommonProperties: () => {},
			identify: () => {},
		} as unknown as Parameters<
			typeof createContextCompactionPrepareTurn
		>[0]["telemetry"];

		const compact = vi.fn(async () => ({
			messages: [{ role: "user" as const, content: "trimmed" }],
		}));
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
				compact,
			},
			telemetry,
		});
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Original task" },
			{ role: "assistant", content: "short answer" },
			{ role: "user", content: "Latest" },
		];
		const apiMessages: LlmsProviders.Message[] = [
			...messages,
			{ role: "assistant", content: "provider-only payload ".repeat(1_000) },
		];

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 3,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages,
			apiMessages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 100 },
			},
		});

		expect(compact).toHaveBeenCalledTimes(1);
		const executed = captureCalls.find(
			(call) => call.event === "task.compaction_executed",
		);
		const props = executed?.properties as Record<string, unknown>;
		expect(props.tokensBefore as number).toBeGreaterThanOrEqual(
			props.triggerTokens as number,
		);
		expect(props.tokensSaved).toBe(
			(props.tokensBefore as number) - (props.tokensAfter as number),
		);
		expect(props.tokensSaved as number).toBeGreaterThanOrEqual(0);
	});

	it("emits task.compaction_skipped when the strategy returns undefined", async () => {
		const emitStatusNotice = vi.fn();
		const captureCalls: Array<{
			event: string;
			properties?: Record<string, unknown>;
		}> = [];
		const telemetry = {
			capture: (call: {
				event: string;
				properties?: Record<string, unknown>;
			}) => captureCalls.push(call),
			captureRequired: () => {},
			setDistinctId: () => {},
			updateCommonProperties: () => {},
			identify: () => {},
		} as unknown as Parameters<
			typeof createContextCompactionPrepareTurn
		>[0]["telemetry"];

		// Force the trigger to fire (small budget vs large transcript) but
		// supply a `compact` callback that intentionally returns undefined
		// so the wrapper records a skip.
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
				compact: async () => undefined,
			},
			telemetry,
			sessionId: "ulid-test-skip",
		});

		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Original task" },
			{ role: "assistant", content: "x".repeat(500) },
			{ role: "user", content: "Latest" },
		];
		const apiMessages: LlmsProviders.Message[] = [
			{ role: "user", content: "api-shaped ".repeat(500) },
		];
		const estimateMessageTokens = createTokenEstimator();
		const sessionInputTokens = messages.reduce(
			(total, message) => total + estimateMessageTokens(message),
			0,
		);
		const apiInputTokens = apiMessages.reduce(
			(total, message) => total + estimateMessageTokens(message),
			0,
		);
		const requestInputTokens = estimateRequestInputTokens({
			systemPrompt: "",
			messages: apiMessages,
			tools: [],
		});
		expect(apiInputTokens).not.toBe(sessionInputTokens);

		const result = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 3,
			emitStatusNotice,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages,
			apiMessages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 100 },
			},
		});

		expect(result).toBeUndefined();
		const skipped = captureCalls.find(
			(call) => call.event === "task.compaction_skipped",
		);
		expect(skipped).toBeDefined();
		const props = skipped?.properties as Record<string, unknown>;
		expect(props.strategy).toBe("custom");
		expect(props.mode).toBe("auto");
		expect(props.reason).toBe("no_result");
		expect(emitStatusNotice).toHaveBeenLastCalledWith(
			"auto-compaction-skipped",
			expect.objectContaining({
				kind: "auto_compaction",
				phase: "skipped",
			}),
		);
		expect(props.ulid).toBe("ulid-test-skip");
		expect(props.tokensBefore).toBe(requestInputTokens);
		expect(typeof props.durationMs).toBe("number");
		expect(
			captureCalls.find((call) => call.event === "task.compaction_executed"),
		).toBeUndefined();
	});

	it("tags telemetry mode as 'manual' when prepareTurn is run with mode: manual", async () => {
		const captureCalls: Array<{
			event: string;
			properties?: Record<string, unknown>;
		}> = [];
		const telemetry = {
			capture: (call: {
				event: string;
				properties?: Record<string, unknown>;
			}) => captureCalls.push(call),
			captureRequired: () => {},
			setDistinctId: () => {},
			updateCommonProperties: () => {},
			identify: () => {},
		} as unknown as Parameters<
			typeof createContextCompactionPrepareTurn
		>[0]["telemetry"];

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
					strategy: "basic",
				},
				telemetry,
			},
			{ mode: "manual" },
		);

		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "Original task" },
			{ role: "assistant", content: "x".repeat(500) },
			{ role: "user", content: "Older followup" },
			{ role: "assistant", content: "x".repeat(500) },
			{ role: "user", content: "Latest" },
		];

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 4,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 100_000 },
			},
		});

		const compactionEvent = captureCalls.find(
			(call) =>
				call.event === "task.compaction_executed" ||
				call.event === "task.compaction_skipped",
		);
		expect(compactionEvent).toBeDefined();
		expect((compactionEvent?.properties as Record<string, unknown>).mode).toBe(
			"manual",
		);
	});

	it("does not immediately re-trigger basic compaction on the next turn after accounting for the protected tail", async () => {
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-codex",
			modelId: "mock-model",
			providerConfig: {
				providerId: "openai-codex",
				modelId: "mock-model",
			} as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, strategy: "basic" },
			logger: undefined,
		});
		const estimateMessageTokens = createTokenEstimator();
		const model = {
			id: "mock-model",
			provider: "openai-codex",
			info: { id: "mock-model", maxInputTokens: 300 },
		};
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "old user context ".repeat(80) },
			{ role: "assistant", content: "old assistant context ".repeat(80) },
			{ role: "user", content: "current request" },
		];
		const triggerTokens = 270;
		const firstResult = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages,
			apiMessages: messages,
			model,
		});

		expect(firstResult?.messages).toBeDefined();
		const firstAfterTokens = firstResult?.messages.reduce(
			(total, message) => total + estimateMessageTokens(message),
			0,
		);
		expect(firstAfterTokens).toBeLessThanOrEqual(triggerTokens);

		const nextTurnMessages: LlmsProviders.Message[] = [
			...(firstResult?.messages ?? []),
			{ role: "assistant", content: "short answer" },
			{ role: "user", content: "next request" },
		];
		const secondResult = await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 2,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages: nextTurnMessages,
			apiMessages: nextTurnMessages,
			model,
		});

		expect(secondResult).toBeUndefined();
	});

	it("keeps stale sidecar state when replacement compaction returns no result", async () => {
		const originalMessages: LlmsProviders.Message[] = [
			{ role: "user", content: "original" },
		];
		const existingState = createSessionCompactionState({
			sourceMessages: originalMessages,
			compactedMessages: [{ role: "user", content: "summary" }],
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const compact = vi.fn().mockResolvedValue(undefined);
		const saveState = vi.fn();
		const prepareTurn = createCompactionStateAwarePrepareTurn({
			compact,
			getState: () => existingState,
			saveState,
		});
		const currentMessages: LlmsProviders.Message[] = [
			{ role: "user", content: "edited original" },
			{ role: "assistant", content: "tail" },
		];

		const result = await prepareTurn({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages: currentMessages,
			apiMessages: currentMessages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 100_000 },
			},
		});

		expect(result).toBeUndefined();
		expect(compact).toHaveBeenCalledWith(
			expect.objectContaining({ messages: currentMessages }),
		);
		expect(saveState).not.toHaveBeenCalled();
	});
});
