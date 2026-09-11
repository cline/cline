import type { LanguageModelV4 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { isOpenAIReasoningEraModelId } from "../model-facts";
import {
	createOpenAICompatibleProviderModule,
	withMaxCompletionTokensForReasoningModels,
} from "./openai-compatible";

describe("isOpenAIReasoningEraModelId", () => {
	it("matches o-series and gpt-5-family model ids", () => {
		for (const modelId of [
			"o1",
			"o1-mini",
			"o1-preview",
			"o3",
			"o3-mini",
			"o3-pro",
			"o4-mini",
			"o4-mini-2025-04-16",
			"openai/o3-mini",
			"azure-o1",
			"gpt-5",
			"gpt-5-mini",
			"gpt-5.2",
			"gpt-5.2-codex",
			"gpt-5-chat-latest",
			"gpt5-nano",
			"openai/gpt-5.2",
			"GPT-5-Mini",
			"azure-gpt-5-mini",
		]) {
			expect(isOpenAIReasoningEraModelId(modelId), modelId).toBe(true);
		}
	});

	it("does not match classic or non-OpenAI model ids", () => {
		for (const modelId of [
			"gpt-4o",
			"gpt-4o-mini",
			"chatgpt-4o-latest",
			"gpt-4.1",
			"gpt-oss-120b",
			"gpt-35-turbo",
			"deepseek-v4-pro",
			"deepseek-reasoner",
			"qwen3-coder-plus",
			"llama-3.1-405b-instruct",
			"claude-sonnet-4-6",
			"yolo1",
			"solo3",
			"o13-custom",
			"grok-4",
			"chatgpt-5",
			"somegpt-5-custom",
			"xgpt5",
		]) {
			expect(isOpenAIReasoningEraModelId(modelId), modelId).toBe(false);
		}
	});

	it("returns false for missing or blank ids", () => {
		expect(isOpenAIReasoningEraModelId(undefined)).toBe(false);
		expect(isOpenAIReasoningEraModelId("")).toBe(false);
		expect(isOpenAIReasoningEraModelId("   ")).toBe(false);
	});
});

describe("withMaxCompletionTokensForReasoningModels", () => {
	it("renames max_tokens to max_completion_tokens for reasoning-era models", () => {
		const body = withMaxCompletionTokensForReasoningModels({
			model: "gpt-5.2",
			max_tokens: 8_192,
			messages: [],
		});

		expect(body).toEqual({
			model: "gpt-5.2",
			max_completion_tokens: 8_192,
			messages: [],
		});
	});

	it("leaves non-reasoning models untouched", () => {
		const body = {
			model: "gpt-4o",
			max_tokens: 8_192,
			messages: [],
		};

		expect(withMaxCompletionTokensForReasoningModels(body)).toBe(body);
	});

	it("leaves reasoning-era requests without max_tokens untouched", () => {
		const body = { model: "o3-mini", messages: [] };

		expect(withMaxCompletionTokensForReasoningModels(body)).toBe(body);
	});

	it("keeps an explicit max_completion_tokens from provider options", () => {
		const body = withMaxCompletionTokensForReasoningModels({
			model: "o4-mini",
			max_tokens: 8_192,
			max_completion_tokens: 1_024,
		});

		expect(body).toEqual({
			model: "o4-mini",
			max_completion_tokens: 1_024,
		});
	});

	it("leaves bodies without a string model id untouched", () => {
		const body = { max_tokens: 8_192 };

		expect(withMaxCompletionTokensForReasoningModels(body)).toBe(body);
	});
});

describe("createOpenAICompatibleProviderModule wire format", () => {
	it("sends max_completion_tokens instead of max_tokens for gpt-5-family generate requests", async () => {
		const { fetchMock, requestBody } = await generate({ modelId: "gpt-5.2" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestBody()).toMatchObject({
			model: "gpt-5.2",
			max_completion_tokens: 8_192,
		});
		expect(requestBody()).not.toHaveProperty("max_tokens");
	});

	it("sends max_completion_tokens instead of max_tokens for o-series streaming requests", async () => {
		const { requestBody } = await stream({ modelId: "o3-mini" });

		expect(requestBody()).toMatchObject({
			model: "o3-mini",
			max_completion_tokens: 8_192,
			stream: true,
		});
		expect(requestBody()).not.toHaveProperty("max_tokens");
	});

	it("keeps max_tokens for ordinary model ids", async () => {
		const { requestBody } = await generate({ modelId: "gpt-4o" });

		expect(requestBody()).toMatchObject({
			model: "gpt-4o",
			max_tokens: 8_192,
		});
		expect(requestBody()).not.toHaveProperty("max_completion_tokens");
	});

	// Regression test for cline/cline#13119: LiteLLM's Anthropic passthrough
	// emits tool_call deltas whose `index` mirrors the Anthropic content-block
	// index (1 when a text block precedes the tool call). Older
	// @ai-sdk/provider-utils stored tool calls in a sparse array keyed by that
	// index and crashed at stream flush with
	// "Cannot read properties of undefined (reading 'hasFinished')".
	it("survives streamed tool_call deltas whose index does not start at 0", async () => {
		const fetchMock = createFetchMock(
			sseToolCallResponseWithNonZeroIndex("claude-opus"),
		);
		const model = await createModel({ modelId: "claude-opus", fetchMock });

		const { stream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			maxOutputTokens: 8_192,
		});

		const parts = await collectStreamParts(stream);

		expect(parts.filter((part) => part.type === "error")).toEqual([]);
		expect(parts.find((part) => part.type === "tool-call")).toMatchObject({
			toolCallId: "toolu_abc",
			toolName: "read_file",
			input: '{"path":"a.txt"}',
		});
	});
});

async function createModel(input: {
	modelId: string;
	fetchMock: ReturnType<typeof vi.fn>;
}): Promise<LanguageModelV4> {
	const provider = await createOpenAICompatibleProviderModule(
		config({ fetch: input.fetchMock as unknown as typeof fetch }),
		context(),
	);
	return provider.operations.language(input.modelId) as LanguageModelV4;
}

async function generate(input: { modelId: string }) {
	const fetchMock = createFetchMock(jsonCompletionResponse(input.modelId));
	const model = await createModel({ modelId: input.modelId, fetchMock });

	await model.doGenerate({
		prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		maxOutputTokens: 8_192,
	});

	return { fetchMock, requestBody: () => capturedBody(fetchMock) };
}

async function stream(input: { modelId: string }) {
	const fetchMock = createFetchMock(sseCompletionResponse(input.modelId));
	const model = await createModel({ modelId: input.modelId, fetchMock });

	await model.doStream({
		prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		maxOutputTokens: 8_192,
	});

	return { fetchMock, requestBody: () => capturedBody(fetchMock) };
}

function createFetchMock(response: () => Response) {
	return vi.fn(async (_input: unknown, _init?: RequestInit) => response());
}

function capturedBody(
	fetchMock: ReturnType<typeof createFetchMock>,
): Record<string, unknown> {
	const init = fetchMock.mock.calls[0]?.[1];
	return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function jsonCompletionResponse(modelId: string): () => Response {
	return () =>
		new Response(
			JSON.stringify({
				id: "chatcmpl-test",
				created: 0,
				model: modelId,
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "OK" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
}

function sseCompletionResponse(modelId: string): () => Response {
	const events = [
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [{ index: 0, delta: { role: "assistant", content: "OK" } }],
		})}`,
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		})}`,
		"data: [DONE]",
		"",
	].join("\n\n");
	return () =>
		new Response(events, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
}

async function collectStreamParts(
	stream: ReadableStream<unknown>,
): Promise<Array<Record<string, unknown> & { type: string }>> {
	const parts: Array<Record<string, unknown> & { type: string }> = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		parts.push(value as Record<string, unknown> & { type: string });
	}
	return parts;
}

function sseToolCallResponseWithNonZeroIndex(modelId: string): () => Response {
	const events = [
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [
				{ index: 0, delta: { role: "assistant", content: "Let me check." } },
			],
		})}`,
		// Anthropic content block 0 is the text above, so the tool call
		// arrives with index 1 and the tracker never sees an index-0 delta.
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{
								index: 1,
								id: "toolu_abc",
								type: "function",
								function: {
									name: "read_file",
									arguments: '{"path":"a.txt"}',
								},
							},
						],
					},
				},
			],
		})}`,
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		})}`,
		"data: [DONE]",
		"",
	].join("\n\n");
	return () =>
		new Response(events, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
}

function config(
	overrides: Partial<GatewayResolvedProviderConfig> = {},
): GatewayResolvedProviderConfig {
	return {
		providerId: "openai-compatible",
		apiKey: "test-api-key",
		baseUrl: "https://api.openai.com/v1",
		...overrides,
	};
}

function context(): GatewayProviderContext {
	return {
		provider: {
			id: "openai-compatible",
			name: "OpenAI Compatible",
			defaultModelId: "gpt-4o",
			models: [],
		},
		model: {
			providerId: "openai-compatible",
			id: "gpt-4o",
			name: "gpt-4o",
		},
		config: config(),
	} as unknown as GatewayProviderContext;
}
