import { ModelInfoSchema } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { normalizeUsage } from "../providers/ai-sdk";
import { GENERATED_PROVIDER_MODELS } from "./catalog.generated";
import { normalizeClineRecommendedProviderModels } from "./catalog-cline-recommended";
import {
	normalizeModelsDevProviderModels,
	normalizeModelsDevProviderSpecs,
} from "./catalog-live";
import {
	isRetiredMiniMaxTextModel,
	MINIMAX_PROVIDER_IDS,
	normalizeMiniMaxModels,
} from "./catalog-minimax";

describe("active MiniMax catalog", () => {
	it.each(
		MINIMAX_PROVIDER_IDS,
	)("keeps only current text models for %s", (providerId) => {
		const models = GENERATED_PROVIDER_MODELS.providers[providerId];
		expect(Object.keys(models).sort()).toEqual([
			"MiniMax-M3",
			"MiniMax-M3.1-Flash",
		]);
		for (const model of Object.values(models)) {
			expect(ModelInfoSchema.safeParse(model).success).toBe(true);
			expect(model.contextWindow).toBe(1_000_000);
			expect(model.maxTokens).toBe(524_288);
			expect(model.modalities).toEqual({
				input: ["text", "image"],
				output: ["text"],
			});
		}
		expect(models["MiniMax-M3.1-Flash"].reasoningOptions).toEqual([
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		]);
		expect(models["MiniMax-M3.1-Flash"].pricing).toEqual({
			input: 0.15,
			output: 0.6,
			cacheRead: 0.015,
		});
		expect(models["MiniMax-M3"].reasoningOptions).toEqual([{ type: "toggle" }]);
	});

	it("filters retired models from refreshed catalogs without inventing routed Flash IDs", () => {
		const payload = {
			minimax: {
				npm: "@ai-sdk/anthropic",
				models: { "MiniMax-M2.7": { tool_call: true } },
			},
			openrouter: {
				npm: "@openrouter/ai-sdk-provider",
				models: {
					"minimax/minimax-m2.5": { tool_call: true },
					"minimax/minimax-m3": {
						tool_call: true,
						cost: { input: 9, output: 10 },
					},
					"other/model": { tool_call: true },
				},
			},
		};
		const models = normalizeModelsDevProviderModels(payload);
		expect(
			normalizeModelsDevProviderSpecs(payload, models).minimax.defaultModelId,
		).toBe("MiniMax-M3.1-Flash");
		expect(Object.keys(models.openrouter).sort()).toEqual([
			"minimax/minimax-m3",
			"other/model",
		]);
		expect(models.openrouter["minimax/minimax-m3"].pricing?.input).toBe(9);
	});

	it("filters retired recommendations while preserving gateway capability fallback", () => {
		const result = normalizeClineRecommendedProviderModels(
			{
				clinePass: [
					{ id: "cline-pass/minimax-m2.7" },
					{ id: "cline-pass/minimax-m3" },
				],
				free: [{ id: "cline-free/minimax-m2.7" }],
				clineCloud: [
					{ id: "cline-cloud/minimax-m3.1-flash-preview" },
					{ id: "cline-cloud/minimax-m3" },
				],
			},
			{
				"vercel-ai-gateway": {
					"minimax/minimax-m2.7": {
						id: "minimax/minimax-m2.7",
						contextWindow: 200_000,
					},
					"minimax/minimax-m3": {
						id: "minimax/minimax-m3",
						contextWindow: 256_000,
						maxTokens: 32_000,
						capabilities: ["images", "tools"],
					},
				},
			},
			{ includeClineCloudModels: true },
		);
		expect(Object.keys(result["cline-pass"])).toEqual([
			"cline-pass/minimax-m3",
		]);
		expect(Object.keys(result.cline)).toEqual(["cline-cloud/minimax-m3"]);
		for (const models of Object.values(result)) {
			expect(Object.values(models)[0]).toMatchObject({
				contextWindow: 256_000,
				maxTokens: 32_000,
				capabilities: ["images", "tools"],
			});
		}
	});

	it("preserves non-text MiniMax models and unrelated models", () => {
		const models = {
			"minimax/speech-02-hd": {
				id: "minimax/speech-02-hd",
				modalities: { input: ["text"] as const, output: ["audio"] as const },
			},
			"other/model": { id: "other/model" },
		};
		const result = normalizeMiniMaxModels("router", models as never);
		expect(result).toEqual(models);
	});

	it("contains no retired text builtins across providers", () => {
		for (const [provider, models] of Object.entries(
			GENERATED_PROVIDER_MODELS.providers,
		)) {
			for (const model of Object.values(models)) {
				if (!model.modalities || model.modalities.output.includes("text")) {
					expect(
						isRetiredMiniMaxTextModel(model.id),
						`${provider}/${model.id}`,
					).toBe(false);
				}
			}
		}
	});

	it.each([
		["MiniMax-M3", 0.3, 1.2, 0.06],
		["MiniMax-M3.1-Flash", 0.15, 0.6, 0.015],
	] as const)("estimates %s costs using the documented base rates and cache reads", (id, input, output, cacheRead) => {
		const model = normalizeMiniMaxModels("minimax", {})[id];
		const usage = normalizeUsage(
			{ inputTokens: 200_000, outputTokens: 100, cachedInputTokens: 100_000 },
			undefined,
			model.pricing,
		);
		expect(usage.totalCost).toBeCloseTo(
			(100_000 * input + 100 * output + 100_000 * cacheRead) / 1_000_000,
			10,
		);
		if (id === "MiniMax-M3") {
			expect(model.description).toContain("$0.60/$2.40/$0.12 above 512k");
			expect(model.description).toContain("1.5x");
		}
	});
});
