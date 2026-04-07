import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicHandler } from "./anthropic";

const anthropicCreateSpy = vi.fn();

beforeEach(() => {
	anthropicCreateSpy.mockReset();
});

vi.mock("@anthropic-ai/sdk", () => {
	class Anthropic {
		messages = {
			create: anthropicCreateSpy,
		};
	}

	return { Anthropic };
});

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

async function collect(stream: AsyncIterable<unknown>) {
	const chunks: unknown[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

describe("AnthropicHandler", () => {
	it("uses top-level automatic prompt caching when model pricing includes cache pricing", async () => {
		anthropicCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new AnthropicHandler({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test-key",
			modelInfo: {
				id: "claude-sonnet-4-6",
				pricing: {
					input: 3,
					output: 15,
					cacheRead: 0.3,
					cacheWrite: 3.75,
				},
			},
		});

		await drain(
			handler.createMessage("system", [
				{ role: "user", content: "Tell me about this repo" },
			]),
		);

		const request = anthropicCreateSpy.mock.calls[0]?.[0] as {
			cache_control?: { type: string };
			system?: Array<{ cache_control?: { type: string }; text?: string }>;
			messages?: Array<{
				content?: Array<{ cache_control?: { type: string }; text?: string }>;
			}>;
		};

		expect(request.cache_control).toEqual({ type: "ephemeral" });
		expect(request.system).toEqual([{ type: "text", text: "system" }]);
		expect(
			request.messages?.flatMap((message) => message.content ?? []),
		).not.toContainEqual(
			expect.objectContaining({
				cache_control: { type: "ephemeral" },
			}),
		);
	});

	it("derives thinking budget from reasoning effort", async () => {
		anthropicCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const handler = new AnthropicHandler({
			providerId: "anthropic",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			thinking: true,
			reasoningEffort: "high",
			maxOutputTokens: 10000,
			modelInfo: {
				id: "anthropic/claude-sonnet-4.6",
				capabilities: ["reasoning", "tools"],
				maxTokens: 10000,
			},
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = anthropicCreateSpy.mock.calls[0]?.[0] as {
			thinking?: { type?: string; budget_tokens?: number };
			max_tokens?: number;
		};
		expect(request.max_tokens).toBe(10000);
		expect(request.thinking).toEqual({
			type: "enabled",
			budget_tokens: 8000,
		});
	});

	it("updates cache usage metrics from message_delta events", async () => {
		anthropicCreateSpy.mockResolvedValueOnce(
			createAsyncIterable([
				{
					type: "message_start",
					message: {
						usage: {
							input_tokens: 3,
							output_tokens: 3,
							cache_creation_input_tokens: 0,
							cache_read_input_tokens: 0,
						},
					},
				},
				{
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: {
						input_tokens: 3,
						output_tokens: 6,
						cache_creation_input_tokens: 100,
						cache_read_input_tokens: 200,
					},
				},
				{ type: "message_stop" },
			]),
		);

		const handler = new AnthropicHandler({
			providerId: "anthropic",
			modelId: "claude-opus-4-6",
			apiKey: "test-key",
			modelInfo: {
				id: "claude-opus-4-6",
				pricing: {
					input: 15,
					output: 75,
					cacheRead: 1.5,
					cacheWrite: 18.75,
				},
			},
		});

		const chunks = await collect(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "usage",
				inputTokens: 3,
				outputTokens: 6,
				cacheWriteTokens: 100,
				cacheReadTokens: 200,
			}),
		);
	});
});
