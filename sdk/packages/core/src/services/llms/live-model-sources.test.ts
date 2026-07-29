import { describe, expect, it, vi } from "vitest";
import {
	fetchHuggingFaceLiveModels,
	fetchOpenRouterLiveModels,
	fetchVercelAiGatewayLiveModels,
} from "./live-model-sources";

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("fetchOpenRouterLiveModels", () => {
	it("parses rich model metadata from the OpenRouter models endpoint", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({
				data: [
					{
						id: "vendor/rich-model",
						name: "Rich Model",
						description: "A rich model",
						context_length: 300_000,
						top_provider: { max_completion_tokens: 32_000 },
						architecture: { modality: ["text", "image"] },
						pricing: {
							prompt: "0.000001",
							completion: "0.000002",
						},
						supports_global_endpoint: true,
						tiers: [{ context_window: 128_000 }],
						supported_parameters: ["tools", "reasoning"],
					},
				],
			}),
		) as unknown as typeof fetch;

		const models = await fetchOpenRouterLiveModels(fetcher);

		expect(models["vendor/rich-model"]).toMatchObject({
			id: "vendor/rich-model",
			name: "Rich Model",
			description: "A rich model",
			contextWindow: 300_000,
			maxTokens: 32_000,
			pricing: { input: 1, output: 2 },
			thinkingConfig: { maxBudget: 6_000 },
			metadata: {
				supportsGlobalEndpoint: true,
				tiers: [{ context_window: 128_000 }],
			},
		});
		expect(models["vendor/rich-model"]?.capabilities).toEqual(
			expect.arrayContaining(["streaming", "tools", "images", "reasoning"]),
		);
	});

	it("applies curated overrides and appends stealth models", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({
				data: [
					{
						id: "moonshotai/kimi-k2",
						name: "Kimi K2",
						context_length: 262_144,
						pricing: { prompt: "0.0000006", completion: "0.0000025" },
					},
					{
						id: "google/gemini-2.5-flash",
						name: "Gemini Flash",
						context_length: 1_000_000,
						top_provider: { max_completion_tokens: 65_536 },
					},
				],
			}),
		) as unknown as typeof fetch;

		const models = await fetchOpenRouterLiveModels(fetcher);

		// kimi-k2 is forced onto the together provider pricing/context.
		expect(models["moonshotai/kimi-k2"]).toMatchObject({
			contextWindow: 131_000,
			pricing: { input: 1, output: 3 },
		});
		// Gemini Flash output tokens are capped.
		expect(models["google/gemini-2.5-flash"]?.maxTokens).toBe(8_192);
		// Stealth models are appended when absent.
		expect(models["stealth/giga-potato"]).toMatchObject({
			name: "Giga Potato",
		});
	});

	it("throws on an invalid payload", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({ unexpected: true }),
		) as unknown as typeof fetch;

		await expect(fetchOpenRouterLiveModels(fetcher)).rejects.toThrow(
			"Invalid response data when fetching OpenRouter models",
		);
	});
});

describe("fetchVercelAiGatewayLiveModels", () => {
	it("parses pricing and derives thinking config and temperature", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({
				data: [
					{
						id: "google/gemini-3-pro",
						name: "Gemini 3 Pro",
						context_window: 1_000_000,
						max_tokens: 64_000,
						tags: ["reasoning"],
						pricing: {
							input: "0.000002",
							output: "0.000012",
							input_cache_read: "0.0000002",
							input_cache_write: "0.0000025",
						},
					},
					{
						id: "vendor/embedding-model",
						type: "embedding",
					},
				],
			}),
		) as unknown as typeof fetch;

		const models = await fetchVercelAiGatewayLiveModels(fetcher);

		expect(models["google/gemini-3-pro"]).toMatchObject({
			contextWindow: 1_000_000,
			maxTokens: 64_000,
			temperature: 1.0,
			thinkingConfig: { maxBudget: 32_767, thinkingLevel: "high" },
			pricing: {
				input: 2,
				output: 12,
				cacheRead: expect.closeTo(0.2),
				cacheWrite: 2.5,
			},
		});
		expect(models["google/gemini-3-pro"]?.capabilities).toEqual(
			expect.arrayContaining(["images", "prompt-cache", "reasoning"]),
		);
		expect(models["vendor/embedding-model"]).toBeUndefined();
	});
});

describe("fetchHuggingFaceLiveModels", () => {
	it("describes live models by their routed providers", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({
				data: [
					{
						id: "vendor/community-model",
						providers: [{ provider: "sambanova" }, { provider: "nebius" }],
					},
				],
			}),
		) as unknown as typeof fetch;

		const models = await fetchHuggingFaceLiveModels(fetcher);

		expect(models["vendor/community-model"]).toMatchObject({
			name: "vendor/community-model",
			maxTokens: 8_192,
			contextWindow: 128_000,
			description: "Available on providers: sambanova, nebius",
		});
	});
});
