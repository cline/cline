import { describe, expect, it } from "vitest";
import { AnthropicHandler } from "./anthropic";

describe("AnthropicHandler prompt cache detection", () => {
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
});
