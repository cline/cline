import { describe, expect, it } from "vitest";
import { MODEL_COLLECTIONS_BY_PROVIDER_ID } from "../providers/model-registry";
import { normalizeBasetenLiveModels } from "./catalog-live-baseten";
import { normalizeGroqLiveModels } from "./catalog-live-groq";
import { normalizeHuggingFaceLiveModels } from "./catalog-live-huggingface";
import {
	isGeminiFlashModelId,
	normalizeOpenRouterLiveModels,
	OPENROUTER_STEALTH_MODELS,
} from "./catalog-live-openrouter";
import { getProviderLiveModelsSource } from "./catalog-live-sources";
import { normalizeVercelAiGatewayLiveModels } from "./catalog-live-vercel-ai-gateway";
import type { ModelInfo } from "./types";

describe("normalizeOpenRouterLiveModels", () => {
	const rawSonnet = {
		id: "anthropic/claude-sonnet-4.5",
		name: "Anthropic: Claude Sonnet 4.5",
		description: "Fast general-purpose model",
		context_length: 1_000_000,
		top_provider: { max_completion_tokens: 64_000 },
		architecture: {
			modality: "text+image->text",
			input_modalities: ["text", "image"],
		},
		pricing: {
			prompt: "0.000003",
			completion: "0.000015",
		},
		supports_global_endpoint: true,
		tiers: [{ context_window: 200_000, input_price: 3 }],
		supported_parameters: ["tools", "temperature", "reasoning"],
	};

	it("parses rich metadata and applies curated Anthropic cache pricing", () => {
		const models = normalizeOpenRouterLiveModels({ data: [rawSonnet] });
		const model = models["anthropic/claude-sonnet-4.5"];

		expect(model).toBeDefined();
		expect(model.name).toBe("Anthropic: Claude Sonnet 4.5");
		expect(model.description).toBe("Fast general-purpose model");
		// The 1m context window is passed through unchanged (ENG-2345).
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxInputTokens).toBe(1_000_000);
		expect(model.maxTokens).toBe(64_000);
		expect(model.pricing).toMatchObject({
			input: 3,
			output: 15,
			// Curated override: OpenRouter omits Anthropic cache pricing.
			cacheWrite: 3.75,
			cacheRead: 0.3,
		});
		expect(model.capabilities).toEqual(
			expect.arrayContaining([
				"images",
				"tools",
				"reasoning",
				"temperature",
				"global-endpoint",
				"prompt-cache",
			]),
		);
		expect(model.thinkingConfig?.maxBudget).toBeGreaterThan(0);
		expect(model.metadata?.tiers).toEqual(rawSonnet.tiers);
	});

	it("applies the gpt-5 and kimi-k2 limit workarounds", () => {
		const models = normalizeOpenRouterLiveModels({
			data: [
				{
					id: "openai/gpt-5",
					name: "OpenAI: GPT-5",
					context_length: 400_000,
					top_provider: { max_completion_tokens: 128_000 },
					pricing: { prompt: "0.00000125", completion: "0.00001" },
				},
				{
					id: "moonshotai/kimi-k2",
					name: "Kimi K2",
					context_length: 63_000,
					pricing: { prompt: "0.0000006", completion: "0.0000025" },
				},
			],
		});

		expect(models["openai/gpt-5"]).toMatchObject({
			maxTokens: 8_192,
			contextWindow: 272_000,
		});
		expect(models["moonshotai/kimi-k2"]).toMatchObject({
			contextWindow: 131_000,
			pricing: expect.objectContaining({ input: 1, output: 3 }),
		});
	});

	it("marks openai/google models with cache-read pricing as prompt-cache capable", () => {
		const models = normalizeOpenRouterLiveModels({
			data: [
				{
					id: "google/gemini-2.5-pro",
					name: "Gemini 2.5 Pro",
					context_length: 1_048_576,
					pricing: {
						prompt: "0.00000125",
						completion: "0.00001",
						input_cache_read: "0.00000031",
						input_cache_write: "0.000002",
					},
				},
			],
		});

		expect(models["google/gemini-2.5-pro"].capabilities).toContain(
			"prompt-cache",
		);
		expect(models["google/gemini-2.5-pro"].pricing?.cacheRead).toBeCloseTo(
			0.31,
		);
	});

	it("clamps Gemini Flash max output tokens", () => {
		const models = normalizeOpenRouterLiveModels({
			data: [
				{
					id: "google/gemini-2.5-flash",
					name: "Gemini 2.5 Flash",
					context_length: 1_048_576,
					top_provider: { max_completion_tokens: 65_535 },
					pricing: { prompt: "0.0000003", completion: "0.0000025" },
				},
			],
		});

		expect(models["google/gemini-2.5-flash"].maxTokens).toBe(8_192);
	});

	it("degrades to an empty result on malformed payloads", () => {
		expect(normalizeOpenRouterLiveModels(undefined)).toEqual({});
		expect(normalizeOpenRouterLiveModels("nope")).toEqual({});
		expect(normalizeOpenRouterLiveModels({ data: "nope" })).toEqual({});
		expect(
			normalizeOpenRouterLiveModels({ data: [{ name: "missing id" }, 42] }),
		).toEqual({});
	});

	it("detects Gemini Flash ids and rejects non-flash ids", () => {
		expect(isGeminiFlashModelId("google/gemini-2.5-flash")).toBe(true);
		expect(isGeminiFlashModelId("gemini-flash-latest")).toBe(true);
		expect(isGeminiFlashModelId("google/gemini-2.5-pro")).toBe(false);
		expect(isGeminiFlashModelId("openai/gpt-5")).toBe(false);
	});

	it("declares stealth models with ids matching their keys", () => {
		for (const [modelId, info] of Object.entries(OPENROUTER_STEALTH_MODELS)) {
			expect(info.id).toBe(modelId);
		}
	});
});

describe("normalizeVercelAiGatewayLiveModels", () => {
	it("parses pricing and derives thinking config and temperature", () => {
		const models = normalizeVercelAiGatewayLiveModels({
			data: [
				{
					id: "google/gemini-3-pro",
					name: "Gemini 3 Pro",
					description: "Reasoning model",
					context_window: 1_048_576,
					max_tokens: 65_536,
					tags: ["reasoning"],
					pricing: {
						input: "0.000002",
						output: "0.000012",
						input_cache_read: "0.0000002",
						input_cache_write: "0.0000025",
					},
				},
				{ id: "some/embedding-model", type: "embedding" },
			],
		});

		const model = models["google/gemini-3-pro"];
		expect(model).toBeDefined();
		expect(models["some/embedding-model"]).toBeUndefined();
		expect(model.pricing).toMatchObject({ input: 2, output: 12 });
		expect(model.capabilities).toEqual(
			expect.arrayContaining(["tools", "images", "prompt-cache", "reasoning"]),
		);
		expect(model.thinkingConfig).toEqual({
			maxBudget: 32_767,
			thinkingLevel: "high",
		});
		expect(model.temperature).toBe(1.0);
	});

	it("degrades to an empty result on malformed payloads", () => {
		expect(normalizeVercelAiGatewayLiveModels(null)).toEqual({});
		expect(normalizeVercelAiGatewayLiveModels({ data: {} })).toEqual({});
	});
});

describe("normalizeGroqLiveModels", () => {
	const curated: Record<string, ModelInfo> = {
		"llama-3.3-70b-versatile": {
			id: "llama-3.3-70b-versatile",
			name: "Llama 3.3 70B Versatile",
			description: "Curated description",
			contextWindow: 131_072,
			maxTokens: 32_768,
			capabilities: ["tools", "prompt-cache"],
			pricing: { input: 0.59, output: 0.79 },
		},
	};

	it("enriches live entries from the curated catalog and filters non-chat models", () => {
		const models = normalizeGroqLiveModels(
			{
				data: [
					{
						id: "llama-3.3-70b-versatile",
						object: "model",
						context_window: 131_072,
						max_completion_tokens: 32_768,
						owned_by: "Meta",
					},
					{ id: "whisper-large-v3", object: "model" },
					{ id: "inactive-model", object: "model", active: false },
					{
						id: "brand-new-model",
						object: "model",
						context_window: 200_000,
						owned_by: "Groq",
					},
				],
			},
			curated,
		);

		expect(models["whisper-large-v3"]).toBeUndefined();
		expect(models["inactive-model"]).toBeUndefined();
		expect(models["llama-3.3-70b-versatile"]).toMatchObject({
			description: "Curated description",
			pricing: expect.objectContaining({ input: 0.59, output: 0.79 }),
			capabilities: expect.arrayContaining(["prompt-cache"]),
		});
		// Unknown live model still gets defaults + a generated description.
		expect(models["brand-new-model"]).toMatchObject({
			contextWindow: 200_000,
			maxTokens: 8_192,
			description: "Groq model with 200,000 token context window",
		});
	});

	it("degrades to an empty result on malformed payloads", () => {
		expect(normalizeGroqLiveModels(undefined, curated)).toEqual({});
		expect(normalizeGroqLiveModels({ data: [null, 1] }, curated)).toEqual({});
	});
});

describe("normalizeBasetenLiveModels", () => {
	it("parses live pricing and reasoning support with curated fallbacks", () => {
		const curated: Record<string, ModelInfo> = {
			"deepseek-ai/DeepSeek-V3.2": {
				id: "deepseek-ai/DeepSeek-V3.2",
				name: "DeepSeek V3.2",
				description: "Curated deepseek",
				contextWindow: 163_840,
				pricing: { input: 0.5, output: 1.5 },
			},
		};
		const models = normalizeBasetenLiveModels(
			{
				data: [
					{
						id: "deepseek-ai/DeepSeek-V3.2",
						object: "model",
						context_length: 163_840,
						max_completion_tokens: 8_192,
						supported_features: ["reasoning"],
						pricing: { prompt: "0.0000006", completion: "0.0000018" },
					},
					{ id: "some-embedding-model", object: "model" },
				],
			},
			curated,
		);

		expect(models["some-embedding-model"]).toBeUndefined();
		expect(models["deepseek-ai/DeepSeek-V3.2"]).toMatchObject({
			description: "Curated deepseek",
			contextWindow: 163_840,
			maxTokens: 8_192,
		});
		expect(models["deepseek-ai/DeepSeek-V3.2"].pricing?.input).toBeCloseTo(0.6);
		expect(models["deepseek-ai/DeepSeek-V3.2"].pricing?.output).toBeCloseTo(
			1.8,
		);
		expect(models["deepseek-ai/DeepSeek-V3.2"].capabilities).toContain(
			"reasoning",
		);
		expect(
			models["deepseek-ai/DeepSeek-V3.2"].thinkingConfig?.maxBudget,
		).toBeGreaterThan(0);
	});

	it("degrades to an empty result on malformed payloads", () => {
		expect(normalizeBasetenLiveModels({ data: 3 })).toEqual({});
	});
});

describe("normalizeHuggingFaceLiveModels", () => {
	it("prefers curated metadata and falls back to router defaults", () => {
		const curated: Record<string, ModelInfo> = {
			"meta-llama/Llama-3.3-70B-Instruct": {
				id: "meta-llama/Llama-3.3-70B-Instruct",
				name: "Llama 3.3 70B Instruct",
				contextWindow: 131_072,
				maxTokens: 4_096,
				pricing: { input: 0.4, output: 0.4 },
			},
		};
		const models = normalizeHuggingFaceLiveModels(
			{
				data: [
					{
						id: "meta-llama/Llama-3.3-70B-Instruct",
						providers: [{ provider: "together" }, { provider: "nebius" }],
					},
					{
						id: "brand/new-model",
						providers: [{ provider: "sambanova" }],
					},
				],
			},
			curated,
		);

		expect(models["meta-llama/Llama-3.3-70B-Instruct"]).toMatchObject({
			contextWindow: 131_072,
			maxTokens: 4_096,
			description: "Available on providers: together, nebius",
		});
		expect(models["brand/new-model"]).toMatchObject({
			contextWindow: 128_000,
			maxTokens: 8_192,
			description: "Available on providers: sambanova",
		});
	});

	it("degrades to an empty result on malformed payloads", () => {
		expect(normalizeHuggingFaceLiveModels([])).toEqual({});
	});
});

describe("openrouter builtin catalog", () => {
	it("bundles stealth models into the openrouter collection but not cline", () => {
		expect(
			MODEL_COLLECTIONS_BY_PROVIDER_ID.openrouter?.models[
				"stealth/giga-potato"
			],
		).toBeDefined();
		expect(
			MODEL_COLLECTIONS_BY_PROVIDER_ID.cline?.models["stealth/giga-potato"],
		).toBeUndefined();
	});
});

describe("getProviderLiveModelsSource", () => {
	it("shares the OpenRouter source between openrouter and cline", () => {
		const openrouter = getProviderLiveModelsSource("openrouter");
		const cline = getProviderLiveModelsSource("cline");
		expect(openrouter).toBeDefined();
		expect(cline).toBe(openrouter);
	});

	it("registers keyless sources only", () => {
		expect(getProviderLiveModelsSource("vercel-ai-gateway")).toBeDefined();
		expect(getProviderLiveModelsSource("huggingface")).toBeDefined();
		// Auth-required providers go through private fetchers instead.
		expect(getProviderLiveModelsSource("groq")).toBeUndefined();
		expect(getProviderLiveModelsSource("baseten")).toBeUndefined();
		expect(getProviderLiveModelsSource("ollama")).toBeUndefined();
	});
});
