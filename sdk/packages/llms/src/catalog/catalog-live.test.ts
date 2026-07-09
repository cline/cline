import { describe, expect, it, vi } from "vitest";
import {
	getGeneratedModelsForProvider,
	getGeneratedProviderModels,
} from "./catalog.generated-access";
import { normalizeClineRecommendedProviderModels } from "./catalog-cline-recommended";
import {
	fetchLiveProviderModels,
	fetchModelsDevProviderModels,
	type ModelsDevPayload,
	normalizeModelsDevProviderModels,
	normalizeModelsDevProviderSpecs,
	resolveMaxInputTokens,
} from "./catalog-live";

describe("models-dev-catalog", () => {
	it("normalizes provider specs for current built-ins and extra OpenAI-compatible providers", () => {
		const payload: ModelsDevPayload = {
			openai: {
				id: "openai",
				name: "OpenAI",
				npm: "@ai-sdk/openai",
				env: ["OPENAI_API_KEY"],
				doc: "https://platform.openai.com/docs/models",
				models: {
					"gpt-test": {
						tool_call: true,
						reasoning: true,
						cost: { cache_read: 1 },
					},
				},
			},
			poolside: {
				id: "poolside",
				name: "Poolside",
				npm: "@ai-sdk/openai-compatible",
				api: "https://inference.poolside.ai/v1/",
				env: ["POOLSIDE_API_KEY"],
				doc: "https://platform.poolside.ai",
				models: {
					"poolside/laguna-m.1": {
						tool_call: true,
						reasoning: true,
					},
				},
			},
			"extra-router": {
				id: "extra-router",
				name: "Extra Router",
				npm: "@ai-sdk/openai-compatible",
				api: "https://extra.example/v1",
				env: ["EXTRA_ROUTER_API_KEY"],
				doc: "https://extra.example/docs",
				models: {
					"extra-model": {
						tool_call: true,
					},
				},
			},
			cohere: {
				id: "cohere",
				name: "Cohere",
				npm: "@ai-sdk/cohere",
				env: ["COHERE_API_KEY"],
				models: {
					command: {
						tool_call: true,
					},
				},
			},
		};

		const providerModels = normalizeModelsDevProviderModels(payload);
		const providerSpecs = normalizeModelsDevProviderSpecs(
			payload,
			providerModels,
		);

		expect(providerSpecs["openai-native"]).toMatchObject({
			id: "openai-native",
			name: "OpenAI",
			family: "openai",
			modelsProviderId: "openai-native",
			defaultModelId: "gpt-test",
			apiKeyEnv: ["OPENAI_API_KEY"],
			docsUrl: "https://platform.openai.com/docs/models",
			capabilities: ["tools", "reasoning", "prompt-cache"],
		});
		expect(providerSpecs.poolside).toMatchObject({
			id: "poolside",
			family: "openai-compatible",
			modelsProviderId: "poolside",
			defaultModelId: "poolside/laguna-m.1",
			defaults: { baseUrl: "https://inference.poolside.ai/v1" },
		});
		expect(providerSpecs["extra-router"]).toMatchObject({
			id: "extra-router",
			family: "openai-compatible",
			modelsProviderId: "extra-router",
			defaultModelId: "extra-model",
		});
		expect(providerSpecs.cohere).toBeUndefined();
		expect(providerModels.cohere).toBeUndefined();
	});

	it("normalizes Cline recommended clinePass models as a generated provider source", () => {
		const result = normalizeClineRecommendedProviderModels(
			{
				clinePass: [
					{
						id: "base-model",
						name: "ClinePass Base Model",
						description: "Included in ClinePass",
					},
					{
						id: "custom-model",
						name: "Custom Model",
					},
				],
			},
			{
				"base-model": {
					id: "base-model",
					name: "OpenRouter Base Model",
					description: "OpenRouter description",
					contextWindow: 200_000,
					maxInputTokens: 180_000,
					maxTokens: 16_384,
					capabilities: ["tools", "reasoning", "images"],
					pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
					releaseDate: "2026-01-01",
					family: "base-family",
				},
			},
		);

		expect(result["cline-pass"]).toEqual({
			"base-model": {
				id: "base-model",
				name: "OpenRouter Base Model",
				description: "Included in ClinePass",
				contextWindow: 200_000,
				maxInputTokens: 180_000,
				maxTokens: 16_384,
				capabilities: ["tools", "reasoning", "images"],
				pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				releaseDate: "2026-01-01",
				family: "base-family",
			},
			"custom-model": {
				id: "custom-model",
				name: "Custom Model",
				description: undefined,
				contextWindow: 128_000,
				maxInputTokens: 128_000,
				maxTokens: 8_192,
				capabilities: ["tools", "reasoning", "temperature"],
				pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		});
	});

	it("matches Cline recommended clinePass models against OpenRouter model names", () => {
		const result = normalizeClineRecommendedProviderModels(
			{
				clinePass: [
					{
						id: "cline-pass/cline-pass/glm-5.2",
						name: "zai/glm-5.2",
					},
				],
			},
			{
				"z-ai/glm-5.2": {
					id: "z-ai/glm-5.2",
					name: "GLM 5.2",
					contextWindow: 256_000,
					maxInputTokens: 200_000,
					maxTokens: 32_000,
					capabilities: ["tools", "reasoning", "temperature"],
					pricing: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
				},
			},
		);

		expect(
			result["cline-pass"]?.["cline-pass/cline-pass/glm-5.2"],
		).toMatchObject({
			id: "cline-pass/cline-pass/glm-5.2",
			name: "GLM 5.2",
			contextWindow: 256_000,
			maxInputTokens: 200_000,
			maxTokens: 32_000,
			pricing: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		});
	});

	it("returns no ClinePass models when clinePass is empty or missing", () => {
		expect(normalizeClineRecommendedProviderModels({}, {})).toEqual({});
		expect(
			normalizeClineRecommendedProviderModels({ clinePass: [] }, {}),
		).toEqual({});
	});

	it("includes zero-priced Cline free models alongside ClinePass models", () => {
		const result = normalizeClineRecommendedProviderModels(
			{
				clinePass: [{ id: "cline-pass/glm-5.1", name: "glm-5.1" }],
				free: [{ id: "kwaipilot/kat-coder-pro", name: "kat-coder-pro" }],
			},
			{
				"kwaipilot/kat-coder-pro": {
					id: "kwaipilot/kat-coder-pro",
					name: "KAT Coder Pro",
					contextWindow: 256_000,
					maxInputTokens: 200_000,
					maxTokens: 32_000,
					capabilities: ["tools", "temperature"],
					pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
				},
			},
		);

		const models = result["cline-pass"] ?? {};
		// ClinePass models stay first so the provider default remains a pass model
		expect(Object.keys(models)).toEqual([
			"cline-pass/glm-5.1",
			"kwaipilot/kat-coder-pro",
		]);
		expect(models["kwaipilot/kat-coder-pro"]).toMatchObject({
			id: "kwaipilot/kat-coder-pro",
			name: "KAT Coder Pro",
			contextWindow: 256_000,
			maxInputTokens: 200_000,
			// free models are billed at $0 regardless of catalog pricing
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
	});

	it("resolves free-model capabilities by slug and ignores free-only payloads", () => {
		const suffixed = normalizeClineRecommendedProviderModels(
			{
				clinePass: [{ id: "cline-pass/glm-5.1" }],
				free: [{ id: "arcee-ai/trinity-large-preview:free" }],
			},
			{
				"arcee-ai/trinity-large-preview:free": {
					id: "arcee-ai/trinity-large-preview:free",
					name: "Trinity Large Preview",
					contextWindow: 512_000,
					maxInputTokens: 400_000,
					maxTokens: 64_000,
					capabilities: ["tools"],
					pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			},
		);
		expect(
			suffixed["cline-pass"]?.["arcee-ai/trinity-large-preview:free"],
		).toMatchObject({
			name: "Trinity Large Preview",
			contextWindow: 512_000,
		});

		// free bucket alone does not create a cline-pass catalog
		expect(
			normalizeClineRecommendedProviderModels(
				{ free: [{ id: "kwaipilot/kat-coder-pro" }] },
				{},
			),
		).toEqual({});
	});

	it("uses input limits as the model request context window", () => {
		expect(resolveMaxInputTokens(undefined)).toBe(128_000);
		expect(
			resolveMaxInputTokens({
				context: 400_000,
				input: 272_000,
				output: 128_000,
			}),
		).toBe(272_000);
		expect(
			resolveMaxInputTokens({
				context: 400_000,
				output: 128_000,
			}),
		).toBe(400_000);
		expect(
			resolveMaxInputTokens({
				context: 400_000,
				input: 128_000,
				output: 272_000,
			}),
		).toBe(128_000);
	});

	it("preserves reported output limits even when context matches output", () => {
		const providerModels = normalizeModelsDevProviderModels({
			openai: {
				models: {
					"input-output-equal": {
						tool_call: true,
						limit: {
							context: 400_000,
							input: 272_000,
							output: 272_000,
						},
					},
					"context-output-equal": {
						tool_call: true,
						limit: {
							context: 4096,
							output: 4096,
						},
					},
				},
			},
		});

		expect(
			providerModels["openai-native"]?.["input-output-equal"]?.maxTokens,
		).toBe(272_000);
		expect(
			providerModels["openai-native"]?.["context-output-equal"]?.maxTokens,
		).toBe(4096);
	});

	it("normalizes payload with model filtering and defaults", () => {
		const payload: ModelsDevPayload = {
			openai: {
				models: {
					"gpt-live": {
						name: "GPT Live",
						tool_call: true,
						reasoning: true,
						structured_output: true,
						temperature: true,
						release_date: "2026-01-01",
						modalities: { input: ["text", "image"] },
						limit: { context: 1_000_000 },
						cost: { input: 1, output: 2, cache_write: 0.8 },
						status: "preview",
						family: "gpt",
					},
					"gpt-no-tools": {
						name: "GPT No Tools",
						tool_call: false,
						family: "gpt",
					},
					"gpt-split-limit": {
						name: "GPT Split Limit",
						tool_call: true,
						limit: {
							context: 400_000,
							input: 272_000,
							output: 128_000,
						},
						family: "gpt",
					},
					"gpt-deprecated": {
						name: "GPT Deprecated",
						tool_call: true,
						status: "deprecated",
						family: "gpt",
					},
				},
			},
			anthropic: {
				models: {
					"claude-defaults": {
						tool_call: true,
						status: "experimental",
						release_date: "2025-02-01",
						family: "claude",
					},
					"claude-older": {
						tool_call: true,
						release_date: "2024-02-01",
						family: "claude",
					},
				},
			},
		};

		const providerModels = normalizeModelsDevProviderModels(payload);

		expect(providerModels).toEqual({
			"openai-native": {
				"gpt-live": {
					id: "gpt-live",
					name: "GPT Live",
					contextWindow: 1_000_000,
					maxInputTokens: 1_000_000,
					maxTokens: 4096,
					capabilities: [
						"images",
						"tools",
						"reasoning",
						"structured_output",
						"temperature",
						"prompt-cache",
					],
					pricing: {
						input: 1,
						output: 2,
						cacheRead: 0,
						cacheWrite: 0.8,
					},
					status: "preview",
					releaseDate: "2026-01-01",
					family: "gpt",
				},
				"gpt-split-limit": {
					id: "gpt-split-limit",
					name: "GPT Split Limit",
					contextWindow: 400_000,
					maxInputTokens: 272_000,
					maxTokens: 128_000,
					capabilities: ["tools"],
					pricing: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					status: undefined,
					releaseDate: undefined,
					family: "gpt",
				},
			},
			anthropic: {
				"claude-defaults": {
					id: "claude-defaults",
					name: "claude-defaults",
					contextWindow: undefined,
					maxInputTokens: 128_000,
					maxTokens: 4096,
					capabilities: ["tools"],
					pricing: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					status: undefined,
					releaseDate: "2025-02-01",
					family: "claude",
				},
				"claude-older": {
					id: "claude-older",
					name: "claude-older",
					contextWindow: undefined,
					maxInputTokens: 128_000,
					maxTokens: 4096,
					capabilities: ["tools"],
					pricing: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					status: undefined,
					releaseDate: "2024-02-01",
					family: "claude",
				},
			},
		});
		expect(Object.keys(providerModels.anthropic ?? {})).toEqual([
			"claude-defaults",
			"claude-older",
		]);
		expect(providerModels["openai-native"]).not.toHaveProperty(
			"gpt-deprecated",
		);
	});

	it("regenerates Codex catalog entries with input request limits", () => {
		expect(
			getGeneratedModelsForProvider("openai-native")["gpt-5.3-codex"]
				?.maxInputTokens,
		).toBe(272_000);
		expect(
			getGeneratedModelsForProvider("openai-native")["gpt-5.3-codex"]
				?.contextWindow,
		).toBe(400_000);
		expect(
			getGeneratedProviderModels()["vercel-ai-gateway"]?.[
				"openai/gpt-5.3-codex"
			]?.maxInputTokens,
		).toBe(272_000);
		expect(
			getGeneratedProviderModels()["vercel-ai-gateway"]?.[
				"openai/gpt-5.3-codex"
			]?.contextWindow,
		).toBe(400_000);
	});

	it("fetches and normalizes models.dev payload", async () => {
		const fetcher = vi.fn(async () => ({
			ok: true,
			json: async () =>
				({
					openai: {
						models: {
							"gpt-live": { tool_call: true },
						},
					},
				}) satisfies ModelsDevPayload,
		}));

		const result = await fetchModelsDevProviderModels(
			"https://models.dev/api.json",
			fetcher as unknown as typeof fetch,
		);

		expect(fetcher).toHaveBeenCalledWith("https://models.dev/api.json");
		expect(result["openai-native"]).toHaveProperty("gpt-live");
	});

	it("fetches live models from models.dev and Cline recommended clinePass models", async () => {
		const fetcher = vi.fn(async (url: string) => {
			if (url === "https://models.dev/api.json") {
				return {
					ok: true,
					json: async () =>
						({
							openrouter: {
								models: {
									"vendor/live-base-model": {
										name: "Live Base Model",
										tool_call: true,
										reasoning: true,
										limit: { context: 256_000, input: 200_000, output: 32_000 },
										cost: { input: 1, output: 2 },
									},
								},
							},
						}) satisfies ModelsDevPayload,
				};
			}

			return {
				ok: true,
				json: async () => ({
					clinePass: [
						{
							id: "cline-pass/live-base-model",
							name: "vendor/live-base-model",
						},
					],
				}),
			};
		});

		const result = await fetchLiveProviderModels(
			"https://models.dev/api.json",
			fetcher as unknown as typeof fetch,
		);

		expect(fetcher).toHaveBeenCalledWith("https://models.dev/api.json");
		expect(fetcher).toHaveBeenCalledWith(
			"https://api.cline.bot/api/v1/ai/cline/recommended-models",
		);
		expect(result.openrouter).toHaveProperty("vendor/live-base-model");
		expect(result["cline-pass"]?.["cline-pass/live-base-model"]).toMatchObject({
			id: "cline-pass/live-base-model",
			name: "Live Base Model",
			contextWindow: 256_000,
			maxInputTokens: 200_000,
			maxTokens: 32_000,
			pricing: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		});
	});

	it("keeps models.dev live models when Cline recommended models fail", async () => {
		const fetcher = vi.fn(async (url: string) => {
			if (url === "https://models.dev/api.json") {
				return {
					ok: true,
					json: async () =>
						({
							openai: {
								models: {
									"gpt-live": { name: "GPT Live", tool_call: true },
								},
							},
						}) satisfies ModelsDevPayload,
				};
			}

			return { ok: false, status: 503 };
		});

		const result = await fetchLiveProviderModels(
			"https://models.dev/api.json",
			fetcher as unknown as typeof fetch,
		);

		expect(result["openai-native"]?.["gpt-live"]?.name).toBe("GPT Live");
		expect(result["cline-pass"]).toBeUndefined();
	});

	it("keeps Cline recommended clinePass models when models.dev fails", async () => {
		const fetcher = vi.fn(async (url: string) => {
			if (url === "https://models.dev/api.json") {
				return { ok: false, status: 503 };
			}

			return {
				ok: true,
				json: async () => ({
					clinePass: [
						{
							id: "cline-pass/live-default-model",
							name: "Live Default Model",
						},
					],
				}),
			};
		});

		const result = await fetchLiveProviderModels(
			"https://models.dev/api.json",
			fetcher as unknown as typeof fetch,
		);

		expect(result["openai-native"]).toBeUndefined();
		expect(
			result["cline-pass"]?.["cline-pass/live-default-model"],
		).toMatchObject({
			id: "cline-pass/live-default-model",
			name: "Live Default Model",
			contextWindow: 128_000,
			maxInputTokens: 128_000,
			maxTokens: 8_192,
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
	});

	it("throws when models.dev request fails", async () => {
		const fetcher = vi.fn(async () => ({
			ok: false,
			status: 503,
		}));

		await expect(
			fetchModelsDevProviderModels(
				"https://models.dev/api.json",
				fetcher as unknown as typeof fetch,
			),
		).rejects.toThrow(
			"Failed to load model catalog from https://models.dev/api.json: HTTP 503",
		);
	});
});
