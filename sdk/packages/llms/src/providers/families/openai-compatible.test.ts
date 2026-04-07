import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

const { streamTextSpy, providerSpy, createOpenAICompatibleSpy } = vi.hoisted(
	() => {
		const provider = vi.fn();
		return {
			streamTextSpy: vi.fn(),
			providerSpy: provider,
			createOpenAICompatibleSpy: vi.fn(() => provider),
		};
	},
);

const { ensureLangfuseTelemetrySpy } = vi.hoisted(() => ({
	ensureLangfuseTelemetrySpy: vi.fn(async () => false),
}));

const { debugLangfuseSpy } = vi.hoisted(() => ({
	debugLangfuseSpy: vi.fn(),
}));

vi.mock("ai", () => ({
	streamText: streamTextSpy,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: createOpenAICompatibleSpy,
}));

vi.mock("../runtime/langfuse-telemetry", () => ({
	debugLangfuse: debugLangfuseSpy,
	ensureLangfuseTelemetry: ensureLangfuseTelemetrySpy,
}));

import { OpenAICompatibleHandler } from "./openai-compatible";

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}

async function drain(stream: AsyncIterable<unknown>) {
	for await (const _chunk of stream) {
		// no-op
	}
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const chunks: T[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

function toJsonSchema(inputSchema: unknown): unknown {
	const maybeWrapped = inputSchema as { jsonSchema?: unknown };
	if (typeof maybeWrapped?.jsonSchema === "function") {
		return (maybeWrapped.jsonSchema as () => unknown)();
	}
	if (maybeWrapped?.jsonSchema) {
		return maybeWrapped.jsonSchema;
	}
	if (inputSchema && typeof inputSchema === "object") {
		try {
			return z.toJSONSchema(inputSchema as z.core.$ZodType);
		} catch {
			// Ignore: not a supported Zod schema instance.
		}
	}
	return undefined;
}

describe("OpenAICompatibleHandler", () => {
	beforeEach(() => {
		streamTextSpy.mockReset();
		providerSpy.mockReset();
		createOpenAICompatibleSpy.mockClear();
		debugLangfuseSpy.mockReset();
		ensureLangfuseTelemetrySpy.mockReset();
		ensureLangfuseTelemetrySpy.mockResolvedValue(false);
		providerSpy.mockReturnValue({ provider: "model" });
		streamTextSpy.mockReturnValue({
			fullStream: createAsyncIterable([{ type: "finish", usage: {} }]),
		});
	});

	it("only applies allowed config capability overrides to fallback model info", () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			capabilities: ["prompt-cache", "reasoning"],
		});

		expect(handler.getModel().info.capabilities).toEqual(["prompt-cache"]);
	});

	it("enables AI SDK telemetry when Langfuse is configured", async () => {
		ensureLangfuseTelemetrySpy.mockResolvedValue(true);
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			experimental_telemetry?: { isEnabled?: boolean };
		};
		expect(request.experimental_telemetry).toMatchObject({ isEnabled: true });
	});

	it("keeps AI SDK telemetry enabled without Langfuse", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "cline",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			experimental_telemetry?: { isEnabled?: boolean };
		};
		expect(request.experimental_telemetry).toMatchObject({ isEnabled: true });
	});

	it("omits OpenRouter reasoning options when thinking is disabled", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			providerOptions?: Record<string, unknown>;
		};
		expect(request.providerOptions).toBeUndefined();
	});

	it("sends raw reasoning config for cline-compatible gateways", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			thinking: true,
			reasoningEffort: "high",
			maxOutputTokens: 10000,
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			providerOptions?: Record<string, unknown>;
		};
		expect(request.providerOptions).toMatchObject({
			cline: {
				reasoning: {
					enabled: true,
					max_tokens: 8000,
				},
			},
		});
		expect(request.providerOptions).not.toMatchObject({
			cline: { reasoningEffort: "high" },
		});
	});

	it("sends raw reasoning config for general openai-compatible providers", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "deepseek",
			modelId: "deepseek-chat",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			thinking: true,
			reasoningEffort: "high",
			maxOutputTokens: 10000,
			modelInfo: {
				id: "deepseek-chat",
				capabilities: ["reasoning"],
				maxTokens: 10000,
			},
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			providerOptions?: Record<string, unknown>;
		};
		expect(request.providerOptions).toMatchObject({
			deepseek: {
				reasoning: {
					enabled: true,
					effort: "high",
				},
			},
		});
		expect(request.providerOptions).not.toMatchObject({
			deepseek: { reasoningEffort: "high" },
		});
	});

	it("sends function tools with object inputSchema", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			knownModels: {
				"anthropic/claude-sonnet-4.6": {
					id: "anthropic/claude-sonnet-4.6",
					pricing: {
						input: 1,
						output: 2,
						cacheRead: 0.5,
						cacheWrite: 1.25,
					},
				},
			},
		});

		await drain(
			handler.createMessage(
				"system",
				[{ role: "user", content: "hi" }],
				[
					{
						name: "read_files",
						description: "Read files",
						inputSchema: {
							type: "object",
							properties: { files: { type: "array" } },
							required: ["files"],
						},
					},
				],
			),
		);

		expect(streamTextSpy).toHaveBeenCalledTimes(1);
		const request = streamTextSpy.mock.calls[0]?.[0] as {
			tools?: Record<string, { inputSchema?: unknown; parameters?: unknown }>;
		};
		const rawJsonSchema = toJsonSchema(request.tools?.read_files?.inputSchema);
		expect(rawJsonSchema).toEqual(
			expect.objectContaining({
				type: "object",
				properties: expect.objectContaining({
					files: expect.objectContaining({ type: "array" }),
				}),
				required: ["files"],
			}),
		);
		expect(request.tools?.read_files?.parameters).toBeUndefined();
	});

	it("normalizes invalid tool schemas to a permissive schema", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			knownModels: {
				"anthropic/claude-sonnet-4.6": {
					id: "anthropic/claude-sonnet-4.6",
					pricing: {
						input: 1,
						output: 2,
						cacheRead: 0.5,
						cacheWrite: 1.25,
					},
				},
			},
		});

		await drain(
			handler.createMessage(
				"system",
				[{ role: "user", content: "hi" }],
				[
					{
						name: "read_files",
						description: "Read files",
						inputSchema: {} as Record<string, unknown>,
					},
				],
			),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			tools?: Record<string, { inputSchema?: unknown }>;
		};
		const rawJsonSchema = toJsonSchema(request.tools?.read_files?.inputSchema);
		expect(rawJsonSchema).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
		});
	});

	it("replays assistant tool history using AI SDK input parts", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage("system", [
				{ role: "user", content: "inspect repo" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_1",
							name: "read_files",
							input: { files: ["/tmp/a.md"] },
						},
					],
				},
			]),
		);

		expect(streamTextSpy).toHaveBeenCalledTimes(1);
		const request = streamTextSpy.mock.calls[0]?.[0] as {
			messages?: Array<{
				role?: string;
				content?: Array<Record<string, unknown>> | string;
			}>;
		};
		const assistantMessage = request.messages?.[2];
		expect(assistantMessage?.role).toBe("assistant");
		const assistantParts = Array.isArray(assistantMessage?.content)
			? assistantMessage.content
			: [];
		expect(assistantParts[0]).toMatchObject({
			type: "tool-call",
			toolCallId: "call_1",
			toolName: "read_files",
			input: { files: ["/tmp/a.md"] },
		});
		expect(assistantParts[0]?.args).toBeUndefined();
	});

	it("applies Anthropic prompt cache markers and automatic caching to OpenRouter requests", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			modelInfo: {
				id: "anthropic/claude-sonnet-4.6",
				pricing: {
					input: 3,
					output: 15,
					cacheRead: 0.3,
					cacheWrite: 3.75,
				},
			},
		});

		await drain(
			handler.createMessage("system prompt", [
				{ role: "user", content: "first prompt" },
				{ role: "assistant", content: "working" },
				{ role: "user", content: "second prompt" },
			]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			providerOptions?: Record<string, unknown>;
			messages?: Array<{
				role?: string;
				content?: Array<Record<string, unknown>> | string;
			}>;
		};
		const systemMessage = request.messages?.[0];
		const firstUserMessage = request.messages?.[1];
		const lastUserMessage = request.messages?.[3];

		expect(request.providerOptions).toEqual({
			openrouter: {
				cache_control: { type: "ephemeral" },
			},
		});
		expect(systemMessage?.content).toBe("system prompt");
		expect(firstUserMessage?.content).toBe("first prompt");
		expect(lastUserMessage?.content).toMatchObject([
			{
				type: "text",
				text: "second prompt",
				providerOptions: {
					openrouter: { cache_control: { type: "ephemeral" } },
				},
			},
		]);
	});

	it("applies Anthropic automatic caching to Cline requests", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			modelInfo: {
				id: "anthropic/claude-sonnet-4.6",
				pricing: {
					input: 3,
					output: 15,
					cacheRead: 0.3,
					cacheWrite: 3.75,
				},
			},
		});

		await drain(
			handler.createMessage("system prompt", [
				{ role: "user", content: "hello" },
			]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			providerOptions?: Record<string, unknown>;
		};

		expect(request.providerOptions).toEqual({
			cline: {
				cache_control: { type: "ephemeral" },
			},
		});
	});

	it("does not add explicit cache markers for non-Anthropic models", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			modelInfo: {
				id: "google/gemma-4-31b-it",
				capabilities: ["prompt-cache"],
			},
		});

		await drain(
			handler.createMessage("system prompt", [
				{ role: "user", content: "hello" },
			]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			messages?: Array<{
				role?: string;
				content?: Array<Record<string, unknown>> | string;
			}>;
		};
		const systemMessage = request.messages?.[0];
		const userMessage = request.messages?.[1];

		expect(systemMessage?.content).toBe("system prompt");
		expect(userMessage?.content).toBe("hello");
	});

	it("reads cache token metrics from OpenRouter-style usage fields", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: createAsyncIterable([
				{
					type: "finish",
					usage: {
						inputTokens: 1000,
						outputTokens: 50,
						prompt_tokens_details: {
							cached_tokens: 900,
							cache_write_tokens: 80,
						},
					},
				},
			]),
		});

		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		const chunks = await collect(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "usage",
				inputTokens: 1000,
				outputTokens: 50,
				cacheReadTokens: 900,
				cacheWriteTokens: 80,
			}),
		);
	});

	it("reads cache write tokens from raw AI SDK usage payloads", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: createAsyncIterable([
				{
					type: "finish",
					usage: {
						inputTokens: 1000,
						outputTokens: 50,
						raw: {
							prompt_tokens_details: {
								cached_tokens: 900,
								cache_write_tokens: 80,
							},
						},
					},
				},
			]),
		});
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		const chunks = await collect(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "usage",
				inputTokens: 1000,
				outputTokens: 50,
				cacheReadTokens: 900,
				cacheWriteTokens: 80,
			}),
		);
	});

	it("reads cache token details from AI SDK v6 usage fields", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: createAsyncIterable([
				{
					type: "finish",
					usage: {
						inputTokens: 1000,
						outputTokens: 50,
						inputTokenDetails: {
							cacheReadTokens: 900,
							cacheWriteTokens: 80,
						},
					},
				},
			]),
		});

		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		const chunks = await collect(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "usage",
				inputTokens: 1000,
				outputTokens: 50,
				cacheReadTokens: 900,
				cacheWriteTokens: 80,
			}),
		);
	});

	it("derives OpenRouter Anthropic reasoning max_tokens from effort", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			thinking: true,
			reasoningEffort: "high",
			maxOutputTokens: 10000,
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			providerOptions?: Record<string, unknown>;
		};
		expect(request.providerOptions).toMatchObject({
			openrouter: {
				reasoning: {
					enabled: true,
					max_tokens: 8000,
				},
			},
		});
	});
});
