import { zodToJsonSchema } from "@clinebot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ApiStreamChunk } from "../types/stream";

const TeamTaskInputSchema = z.object({
	task: z.string(),
	details: z
		.object({
			priority: z.enum(["low", "high"]).optional(),
			notes: z.string().optional(),
		})
		.optional(),
});

const chatCompletionsCreateSpy = vi.fn();

beforeEach(() => {
	chatCompletionsCreateSpy.mockClear();
});

vi.mock("openai", () => {
	class OpenAI {
		chat = {
			completions: {
				create: chatCompletionsCreateSpy,
			},
		};
	}

	return {
		default: OpenAI,
	};
});

import { OpenAIBaseHandler } from "./openai-chat";

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}

async function collectChunks(stream: AsyncIterable<ApiStreamChunk>) {
	const chunks: ApiStreamChunk[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

describe("OpenAIBaseHandler", () => {
	it("derives OpenRouter Anthropic reasoning max_tokens from effort", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new OpenAIBaseHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com",
			thinking: true,
			reasoningEffort: "high",
			maxOutputTokens: 10000,
		});

		await collectChunks(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			reasoning?: {
				enabled?: boolean;
				effort?: string;
				max_tokens?: number;
			};
		};
		expect(request.reasoning).toEqual({
			enabled: true,
			max_tokens: 8000,
		});
	});

	it("adds Anthropic automatic prompt caching for OpenRouter requests", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new OpenAIBaseHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com",
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

		await collectChunks(
			handler.createMessage("system", [{ role: "user", content: "hello" }]),
		);

		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			cache_control?: { type: string };
			messages?: Array<{
				content:
					| string
					| Array<{ cache_control?: { type: string }; text?: string }>;
				role: string;
			}>;
		};

		expect(request.cache_control).toEqual({ type: "ephemeral" });
		expect(request.messages?.[0]).toMatchObject({
			role: "system",
			content: [{ text: "system", cache_control: { type: "ephemeral" } }],
		});
		expect(request.messages?.[1]).toMatchObject({
			role: "user",
			content: [{ text: "hello", cache_control: { type: "ephemeral" } }],
		});
	});

	it("adds Anthropic automatic prompt caching for Cline requests", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new OpenAIBaseHandler({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com",
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

		await collectChunks(
			handler.createMessage("system", [{ role: "user", content: "hello" }]),
		);

		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			cache_control?: { type: string };
		};

		expect(request.cache_control).toEqual({ type: "ephemeral" });
	});

	it("adds Anthropic automatic prompt caching for Vercel AI Gateway requests", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new OpenAIBaseHandler({
			providerId: "vercel-ai-gateway",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com",
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

		await collectChunks(
			handler.createMessage("system", [{ role: "user", content: "hello" }]),
		);

		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			cache_control?: { type: string };
		};

		expect(request.cache_control).toEqual({ type: "ephemeral" });
	});

	it("does not add Anthropic automatic prompt caching for non-Anthropic models", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new OpenAIBaseHandler({
			providerId: "openrouter",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: "https://example.com",
			modelInfo: {
				id: "google/gemma-4-31b-it",
				capabilities: ["prompt-cache"],
			},
		});

		await collectChunks(
			handler.createMessage("system", [{ role: "user", content: "hello" }]),
		);

		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			cache_control?: { type: string };
			messages?: Array<{ content: string | unknown[]; role: string }>;
		};

		expect(request.cache_control).toBeUndefined();
		expect(request.messages).toEqual([
			{ role: "system", content: "system" },
			{ role: "user", content: "hello" },
		]);
	});

	it("normalizes invalid tool schemas for remapped providers", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new OpenAIBaseHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});

		await collectChunks(
			handler.createMessage(
				"system",
				[{ role: "user", content: "Use a tool" }],
				[
					{
						name: "read_files",
						description: "Read files",
						inputSchema: {} as Record<string, unknown>,
					},
				],
			),
		);

		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			tools?: Array<{
				function: {
					parameters?: unknown;
					strict: boolean;
				};
			}>;
		};

		expect(request.tools?.[0]?.function.strict).toBe(false);
		expect(request.tools?.[0]?.function.parameters).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
		});
	});

	it("forwards team_task optional-field schemas with strict=true on chat-completions requests", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const teamTaskSchema = zodToJsonSchema(TeamTaskInputSchema);
		const handler = new OpenAIBaseHandler({
			providerId: "openai-compatible",
			modelId: "gpt-4.1",
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});

		await collectChunks(
			handler.createMessage(
				"system",
				[{ role: "user", content: "List ready tasks" }],
				[
					{
						name: "team_task",
						description: "Manage shared team tasks.",
						inputSchema: teamTaskSchema,
					},
				],
			),
		);

		expect(chatCompletionsCreateSpy).toHaveBeenCalledTimes(1);
		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			tools?: Array<{
				type: string;
				function: {
					name: string;
					description: string;
					parameters: unknown;
					strict: boolean;
				};
			}>;
		};
		expect(request.tools).toEqual([
			{
				type: "function",
				function: {
					name: "team_task",
					description: "Manage shared team tasks.",
					parameters: teamTaskSchema,
					strict: true,
				},
			},
		]);
	});
});
