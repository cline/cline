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

describe("AnthropicHandler", () => {
	it("enables prompt caching when model pricing includes cache pricing", () => {
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

		const messages = handler.getMessages("system", [
			{ role: "user", content: "Tell me about this repo" },
		]);
		const userTextBlock = messages[0]?.content?.[0] as
			| { cache_control?: { type: string } }
			| undefined;

		expect(userTextBlock?.cache_control).toEqual({ type: "ephemeral" });
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
});
