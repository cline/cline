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
	it("normalizes current built-ins and providers using supported AI SDK packages", () => {
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
						reasoning_options: [{ type: "effort", values: ["medium", "high"] }],
						cost: { cache_read: 1 },
						modalities: {
							input: ["text", "audio"],
							output: ["text"],
						},
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
			"extra-anthropic": {
				id: "extra-anthropic",
				name: "Extra Anthropic",
				npm: "@ai-sdk/anthropic",
				models: {
					"claude-extra": {
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
		expect(providerModels["openai-native"]["gpt-test"].modalities).toEqual({
			input: ["text", "audio"],
			output: ["text"],
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
		expect(providerSpecs["extra-anthropic"]).toMatchObject({
			id: "extra-anthropic",
			family: "anthropic",
			modelsProviderId: "extra-anthropic",
			defaultModelId: "claude-extra",
		});
		expect(providerSpecs.cohere).toBeUndefined();
		expect(providerModels.cohere).toBeUndefined();
		expect(
			providerModels["openai-native"]?.["gpt-test"]?.reasoningOptions,
		).toEqual([{ type: "effort", values: ["medium", "high"] }]);
	});

	it("keeps dedicated image models without tool calling", () => {
		const providerModels = normalizeModelsDevProviderModels({
			openai: {
				id: "openai",
				name: "OpenAI",
				npm: "@ai-sdk/openai",
				models: {
					"chat-model": {
						tool_call: true,
						modalities: { input: ["text"], output: ["text"] },
					},
					"image-model": {
						tool_call: false,
						modalities: { input: ["text"], output: ["image"] },
					},
					"gpt-image-with-text-output": {
						tool_call: false,
						family: "gpt-image",
						modalities: {
							input: ["text", "image"],
							output: ["text", "image"],
						},
					},
					"embedding-model": {
						tool_call: false,
						modalities: { input: ["text"], output: ["text"] },
					},
				},
			},
		});

		expect(providerModels["openai-native"]).toMatchObject({
			"chat-model": expect.any(Object),
			"image-model": {
				modalities: { input: ["text"], output: ["image"] },
			},
			"gpt-image-with-text-output": {
				family: "gpt-image",
				modalities: { input: ["text", "image"], output: ["image"] },
			},
		});
		expect(providerModels["openai-native"]).not.toHaveProperty(
			"embedding-model",
		);
	});

	it("only admits media models for providers with an explicit operation transport", () => {
		const providerModels = normalizeModelsDevProviderModels({
			"extra-router": {
				id: "extra-router",
				name: "Extra Router",
				npm: "@ai-sdk/openai-compatible",
				models: {
					"compatible-image": {
						tool_call: false,
						modalities: { input: ["text"], output: ["image"] },
					},
					"mixed-model": {
						tool_call: false,
						modalities: {
							input: ["text"],
							output: ["text", "image"],
						},
					},
					"chat-model": {
						tool_call: true,
						modalities: { input: ["text"], output: ["text"] },
					},
				},
			},
			xai: {
				id: "xai",
				name: "xAI",
				npm: "@ai-sdk/openai-compatible",
				models: {
					"supported-image": {
						tool_call: false,
						modalities: {
							input: ["text", "image", "pdf"],
							output: ["image", "pdf"],
						},
					},
				},
			},
			"extra-anthropic": {
				id: "extra-anthropic",
				name: "Extra Anthropic",
				npm: "@ai-sdk/anthropic",
				models: {
					"unsupported-image": {
						// Tool metadata must not make an image-only model usable via
						// a language-model-only provider factory.
						tool_call: true,
						modalities: { input: ["text"], output: ["image"] },
					},
					"mixed-model": {
						tool_call: false,
						modalities: {
							input: ["text"],
							output: ["text", "image"],
						},
					},
					"chat-model": { tool_call: true },
				},
			},
			"extra-mistral": {
				id: "extra-mistral",
				name: "Extra Mistral",
				npm: "@ai-sdk/mistral",
				models: {
					"unsupported-image": {
						tool_call: false,
						modalities: { input: ["text"], output: ["image"] },
					},
					"chat-model": { tool_call: true },
				},
			},
			google: {
				id: "google",
				name: "Google",
				npm: "@ai-sdk/google",
				models: {
					"supported-image": {
						tool_call: false,
						modalities: { input: ["text"], output: ["image"] },
					},
				},
			},
			poe: {
				id: "poe",
				name: "Poe",
				npm: "@ai-sdk/openai-compatible",
				models: {
					"unsupported-image": {
						tool_call: false,
						modalities: { input: ["text"], output: ["image"] },
					},
					"chat-model": { tool_call: true },
				},
			},
		});

		expect(providerModels["extra-router"]).not.toHaveProperty(
			"compatible-image",
		);
		expect(providerModels["extra-router"]).not.toHaveProperty("mixed-model");
		expect(providerModels["extra-router"]).toHaveProperty("chat-model");
		expect(providerModels.xai?.["supported-image"]?.modalities).toEqual({
			input: ["text", "image"],
			output: ["image"],
		});
		expect(providerModels["extra-anthropic"]).not.toHaveProperty(
			"unsupported-image",
		);
		expect(providerModels["extra-anthropic"]).not.toHaveProperty("mixed-model");
		expect(providerModels["extra-mistral"]).not.toHaveProperty(
			"unsupported-image",
		);
		expect(providerModels.gemini).toHaveProperty("supported-image");
		expect(providerModels.poe).toHaveProperty("chat-model");
		expect(providerModels.poe).not.toHaveProperty("unsupported-image");
	});

	it("prefers a text-output model over a newer dedicated image default", () => {
		const payload: ModelsDevPayload = {
			openai: {
				id: "openai",
				name: "OpenAI",
				npm: "@ai-sdk/openai",
				models: {
					"chat-model": {
						tool_call: true,
						release_date: "2026-01-01",
						modalities: { input: ["text"], output: ["text"] },
					},
					"new-image-model": {
						tool_call: false,
						release_date: "2026-02-01",
						modalities: { input: ["text"], output: ["image"] },
					},
				},
			},
		};
		const providerModels = normalizeModelsDevProviderModels(payload);

		expect(Object.keys(providerModels["openai-native"] ?? {})[0]).toBe(
			"new-image-model",
		);
		expect(
			normalizeModelsDevProviderSpecs(payload, providerModels)["openai-native"]
				?.defaultModelId,
		).toBe("chat-model");
	});

	it("classifies transcription models with explicit batch and streaming modes", () => {
		const providerModels = normalizeModelsDevProviderModels({
			groq: {
				id: "groq",
				name: "Groq",
				models: {
					"chat-model": {
						tool_call: true,
						modalities: { input: ["text"], output: ["text"] },
					},
					"whisper-large-v3": {
						tool_call: false,
						modalities: { input: ["audio"], output: ["text"] },
					},
					"gpt-realtime-whisper": {
						name: "GPT Realtime Whisper",
						tool_call: false,
						modalities: { input: ["audio"], output: ["text"] },
					},
					"speech-model": {
						tool_call: false,
						modalities: { input: ["text"], output: ["audio"] },
					},
				},
			},
			vercel: {
				id: "vercel",
				name: "Vercel AI Gateway",
				models: {
					"openai/whisper-1": {
						tool_call: false,
						modalities: { input: ["audio"], output: ["text"] },
					},
					"openai/gpt-realtime-whisper": {
						tool_call: false,
						modalities: { input: ["audio"], output: ["text"] },
					},
				},
			},
		});

		expect(providerModels.groq?.["whisper-large-v3"]).toMatchObject({
			operation: "transcription",
			operationModes: ["batch"],
			modalities: { input: ["audio"], output: ["text"] },
		});
		expect(providerModels.groq).not.toHaveProperty("gpt-realtime-whisper");
		expect(providerModels.groq).not.toHaveProperty("speech-model");
		expect(providerModels["vercel-ai-gateway"]).toMatchObject({
			"openai/whisper-1": {
				operation: "transcription",
				operationModes: ["batch"],
			},
			"openai/gpt-realtime-whisper": {
				operation: "transcription",
				operationModes: ["streaming"],
			},
		});
	});

	it("admits transcription only through an explicit provider operation", () => {
		const providerModels = normalizeModelsDevProviderModels({
			groq: {
				id: "groq",
				name: "Groq",
				models: {
					"whisper-large-v3": {
						tool_call: false,
						modalities: { input: ["audio"], output: ["text"] },
					},
				},
			},
			greenpt: {
				id: "greenpt",
				name: "GreenPT",
				npm: "@ai-sdk/openai-compatible",
				models: {
					"chat-model": {
						tool_call: true,
						modalities: { input: ["text"], output: ["text"] },
					},
					"green-s": {
						tool_call: false,
						modalities: { input: ["audio"], output: ["text"] },
					},
				},
			},
		});

		expect(providerModels.groq).toHaveProperty("whisper-large-v3");
		expect(providerModels.greenpt).toHaveProperty("chat-model");
		expect(providerModels.greenpt).not.toHaveProperty("green-s");
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
					reasoningOptions: [
						{ type: "effort", values: ["low", "medium", "high"] },
					],
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
				reasoningOptions: [
					{ type: "effort", values: ["low", "medium", "high"] },
				],
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

	it("matches Cline recommended clinePass models against OpenRouter model slugs", () => {
		const result = normalizeClineRecommendedProviderModels(
			{
				clinePass: [
					{
						id: "cline-pass/glm-5.2",
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

		expect(result["cline-pass"]?.["cline-pass/glm-5.2"]).toMatchObject({
			id: "cline-pass/glm-5.2",
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

	it("includes Cline free models alongside ClinePass models", () => {
		const result = normalizeClineRecommendedProviderModels(
			{
				clinePass: [{ id: "cline-pass/glm-5.1", name: "glm-5.1" }],
				free: [{ id: "cline-free/kat-coder-pro", name: "kat-coder-pro" }],
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
			"cline-free/kat-coder-pro",
		]);
		expect(models["cline-free/kat-coder-pro"]).toMatchObject({
			id: "cline-free/kat-coder-pro",
			name: "KAT Coder Pro (free)",
			contextWindow: 256_000,
			maxInputTokens: 200_000,
			// free models are billed at $0 regardless of catalog pricing
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
		expect(result.cline?.["cline-free/kat-coder-pro"]).toMatchObject({
			id: "cline-free/kat-coder-pro",
			name: "KAT Coder Pro (free)",
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
		expect(models["cline-free/kat-coder-pro"]).not.toBe(
			result.cline?.["cline-free/kat-coder-pro"],
		);
	});

	it("labels a Cline free model when its name matches a ClinePass model", () => {
		const result = normalizeClineRecommendedProviderModels(
			{
				clinePass: [
					{
						id: "cline-pass/deepseek-v4-flash",
						name: "DeepSeek V4 Flash",
					},
				],
				free: [
					{
						id: "cline-free/deepseek-v4-flash",
						name: "DeepSeek V4 Flash",
					},
				],
			},
			{},
		);

		expect(result["cline-pass"]?.["cline-pass/deepseek-v4-flash"]?.name).toBe(
			"DeepSeek V4 Flash",
		);
		expect(result["cline-pass"]?.["cline-free/deepseek-v4-flash"]?.name).toBe(
			"DeepSeek V4 Flash (free)",
		);
		expect(result.cline?.["cline-free/deepseek-v4-flash"]?.name).toBe(
			"DeepSeek V4 Flash (free)",
		);
	});

	it("resolves free-model capabilities by slug and preserves free-only Cline catalog payloads", () => {
		const suffixed = normalizeClineRecommendedProviderModels(
			{
				clinePass: [{ id: "cline-pass/glm-5.1" }],
				free: [{ id: "cline-free/trinity-large-preview:free" }],
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
			suffixed["cline-pass"]?.["cline-free/trinity-large-preview:free"],
		).toMatchObject({
			name: "Trinity Large Preview (free)",
			contextWindow: 512_000,
		});
		expect(
			suffixed.cline?.["cline-free/trinity-large-preview:free"],
		).toMatchObject({
			name: "Trinity Large Preview (free)",
			contextWindow: 512_000,
		});

		// free bucket alone updates the Cline provider catalog but does not rotate
		// ClinePass away from its bundled subscription list/default.
		const freeOnly = normalizeClineRecommendedProviderModels(
			{ free: [{ id: "cline-free/kat-coder-pro" }] },
			{},
		);
		expect(freeOnly.cline?.["cline-free/kat-coder-pro"]).toBeDefined();
		expect(freeOnly["cline-pass"]).toBeUndefined();
	});

	it("normalizes cline-free ids from the free endpoint bucket", () => {
		const result = normalizeClineRecommendedProviderModels(
			{ free: [{ id: "cline-free/k2-think" }] },
			{
				"moonshotai/k2-think": {
					id: "moonshotai/k2-think",
					name: "K2 Think",
					contextWindow: 1_000_000,
					maxInputTokens: 800_000,
					maxTokens: 128_000,
					capabilities: ["tools", "reasoning"],
					pricing: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
				},
			},
		);

		expect(result).toEqual({
			cline: {
				"cline-free/k2-think": expect.objectContaining({
					id: "cline-free/k2-think",
					name: "K2 Think (free)",
					contextWindow: 1_000_000,
					pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				}),
			},
		});
	});

	it("resolves OpenRouter display names for free models with full catalog ids", () => {
		// The recommended-models endpoint sends slug-like names (e.g.
		// "deepseek-v4-flash"); the overlay must keep the OpenRouter display
		// name so merged cline/cline-pass catalogs don't show raw ids.
		const result = normalizeClineRecommendedProviderModels(
			{
				free: [
					{ id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
					{ id: "poolside/laguna-s-2.1:free", name: "laguna-s-2.1:free" },
					{ id: "unknown/mystery-model", name: "mystery-model" },
				],
			},
			{
				"deepseek/deepseek-v4-flash": {
					id: "deepseek/deepseek-v4-flash",
					name: "DeepSeek V4 Flash",
					contextWindow: 1_000_000,
					maxInputTokens: 800_000,
					maxTokens: 128_000,
					capabilities: ["tools", "reasoning"],
					pricing: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
				},
				"poolside/laguna-s-2.1:free": {
					id: "poolside/laguna-s-2.1:free",
					name: "Laguna S 2.1 (free)",
					contextWindow: 262_144,
					maxInputTokens: 262_144,
					maxTokens: 32_768,
					capabilities: ["tools"],
					pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			},
		);

		expect(result.cline?.["deepseek/deepseek-v4-flash"]).toMatchObject({
			id: "deepseek/deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
		expect(result.cline?.["poolside/laguna-s-2.1:free"]?.name).toBe(
			"Laguna S 2.1 (free)",
		);
		// Without a catalog match, fall back to the endpoint-provided name.
		expect(result.cline?.["unknown/mystery-model"]?.name).toBe("mystery-model");
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
						modalities: { input: ["text", "image", "video"] },
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
						"video",
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

	it("regenerates image models with supported endpoint routing", () => {
		expect(
			getGeneratedModelsForProvider("openai-native")["gpt-image-1.5"]
				?.modalities?.output,
		).toEqual(["image"]);
		expect(
			getGeneratedModelsForProvider("xai")["grok-imagine-image"]?.modalities,
		).toEqual({ input: ["text", "image"], output: ["image"] });

		const poeDedicatedImages = Object.values(
			getGeneratedModelsForProvider("poe"),
		).filter(
			(model) =>
				model.modalities?.output.includes("image") === true &&
				model.modalities.output.includes("text") !== true,
		);
		expect(poeDedicatedImages).toEqual([]);
	});

	it("includes video input for direct MiniMax M3 catalog entries", () => {
		for (const providerId of [
			"minimax",
			"minimax-cn",
			"minimax-coding-plan",
			"minimax-cn-coding-plan",
		]) {
			expect(
				getGeneratedModelsForProvider(providerId)["MiniMax-M3"]?.capabilities,
			).toEqual(expect.arrayContaining(["images", "video"]));
		}
	});

	it("regenerates transcription models through explicit operation routes", () => {
		expect(
			getGeneratedModelsForProvider("groq")["whisper-large-v3"],
		).toMatchObject({
			operation: "transcription",
			operationModes: ["batch"],
			modalities: { input: ["audio"], output: ["text"] },
		});
		expect(
			getGeneratedModelsForProvider("vercel-ai-gateway")[
				"openai/gpt-realtime-whisper"
			],
		).toMatchObject({
			operation: "transcription",
			operationModes: ["streaming"],
		});
		expect(
			getGeneratedModelsForProvider("groq")["canopylabs/orpheus-v1-english"],
		).toBeUndefined();
		expect(getGeneratedModelsForProvider("greenpt")["green-s"]).toBeUndefined();
		expect(
			getGeneratedModelsForProvider("alibaba")["qwen3-asr-flash"],
		).toBeUndefined();
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
