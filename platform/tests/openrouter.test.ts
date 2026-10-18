import { describe, expect, it } from "vitest";
import { filterModels, normalizeOpenRouterModels } from "@/lib/openrouter/models";
import {
	classifyOpenRouterError,
	computeCost,
	contextLabel,
	pricingSummary,
} from "@/lib/openrouter/pricing";

const payload = {
	data: [
		{
			id: "anthropic/claude-sonnet-4",
			name: "Claude Sonnet 4",
			description: "A capable model",
			context_length: 200000,
			architecture: { input_modalities: ["text", "image"] },
			pricing: { prompt: "0.000003", completion: "0.000015" },
			supported_parameters: ["tools", "temperature"],
			top_provider: { max_completion_tokens: 64000, is_moderated: false },
		},
		{
			id: "meta/llama-chat",
			name: "Llama Chat",
			context_length: 8192,
			architecture: { modality: "text->text" },
			pricing: { prompt: "0", completion: "0" },
			supported_parameters: [],
		},
		{ id: "" },
	],
};

describe("OpenRouter model normalization", () => {
	it("normalizes pricing, capabilities and providers", () => {
		const models = normalizeOpenRouterModels(payload);
		expect(models).toHaveLength(2);

		const sonnet = models.find((model) => model.id === "anthropic/claude-sonnet-4");
		expect(sonnet).toBeDefined();
		expect(sonnet?.provider).toBe("anthropic");
		expect(sonnet?.supportsTools).toBe(true);
		expect(sonnet?.contextLength).toBe(200000);
		expect(sonnet?.pricing.promptPerMillion).toBeCloseTo(3);
		expect(sonnet?.pricing.completionPerMillion).toBeCloseTo(15);
		expect(sonnet?.inputModalities).toEqual(["text", "image"]);

		const llama = models.find((model) => model.id === "meta/llama-chat");
		expect(llama?.supportsTools).toBe(false);
		expect(llama?.inputModalities).toEqual(["text"]);
	});

	it("rejects malformed payloads instead of silently returning nothing", () => {
		expect(() => normalizeOpenRouterModels({ data: "nope" })).toThrow();
		expect(() => normalizeOpenRouterModels(null)).toThrow();
	});

	it("filters by tool support, provider and context", () => {
		const models = normalizeOpenRouterModels(payload);
		expect(filterModels(models, { toolsOnly: true }).map((model) => model.id)).toEqual([
			"anthropic/claude-sonnet-4",
		]);
		expect(filterModels(models, { provider: "meta" })).toHaveLength(1);
		expect(filterModels(models, { minContext: 100000 })).toHaveLength(1);
		expect(filterModels(models, { search: "sonnet" })).toHaveLength(1);
	});
});

describe("pricing", () => {
	const model =
		normalizeOpenRouterModels(payload).find((m) => m.id === "anthropic/claude-sonnet-4") ?? null;

	it("computes list-price cost from per-token pricing", () => {
		const result = computeCost({ inputTokens: 1000, outputTokens: 500 }, model);
		expect(result.basis).toBe("list-price");
		expect(result.costUsd).toBeCloseTo(1000 * 0.000003 + 500 * 0.000015, 8);
	});

	it("returns an unknown basis when the model is not in discovery", () => {
		const result = computeCost({ inputTokens: 1000, outputTokens: 100 }, null);
		expect(result.costUsd).toBe(0);
		expect(result.basis).toBe("unknown");
		expect(result.pricing).toBeNull();
	});

	it("formats pricing and context labels", () => {
		expect(model ? pricingSummary(model) : "").toContain("per 1M tokens");
		expect(contextLabel(200000)).toBe("200k context");
		expect(contextLabel(1_000_000)).toBe("1.0M context");
		expect(contextLabel(null)).toBe("Context unknown");
	});
});

describe("error classification", () => {
	it("marks auth and credit failures as permanent", () => {
		expect(classifyOpenRouterError(401, "no auth").retryable).toBe(false);
		expect(classifyOpenRouterError(402, "no credits").code).toBe("provider_credits_exhausted");
		expect(classifyOpenRouterError(403, "forbidden").retryable).toBe(false);
	});

	it("marks rate limits and server failures as retryable", () => {
		expect(classifyOpenRouterError(429, "slow down").retryable).toBe(true);
		expect(classifyOpenRouterError(500, "boom").retryable).toBe(true);
		expect(classifyOpenRouterError(503, "unavailable").retryable).toBe(true);
	});

	it("never echoes credentials from an upstream body", () => {
		const info = classifyOpenRouterError(401, "Bearer sk-or-v1-supersecret was rejected");
		expect(info.message).not.toContain("sk-or-v1-supersecret");
	});
});
