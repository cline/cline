import {
	CLINE_DEFAULT_MODEL_ID,
	CLINE_ENVIRONMENT_ENV,
	CLINE_ENVIRONMENTS,
	type GatewayProviderContext,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	BUILTIN_PROVIDER_MANIFESTS_BY_ID,
	BUILTIN_SPECS,
	resolveProviderApiLineBaseUrl,
} from "./builtins";
import { getModelsForProvider, getProvider } from "./model-registry";
import { GENERATED_PROVIDER_SPECS } from "./providers.generated";
import { resolveAnthropicReasoningRequestPolicy } from "./routing/anthropic-compatible";

function findClineSpec() {
	const spec = BUILTIN_SPECS.find((s) => s.id === "cline");
	if (!spec) {
		throw new Error("cline builtin spec not found");
	}
	return spec;
}

describe("cline builtin spec defaults.baseUrl", () => {
	const originalEnvironment = process.env[CLINE_ENVIRONMENT_ENV];

	beforeEach(() => {
		delete process.env[CLINE_ENVIRONMENT_ENV];
	});

	afterEach(() => {
		if (originalEnvironment === undefined) {
			delete process.env[CLINE_ENVIRONMENT_ENV];
		} else {
			process.env[CLINE_ENVIRONMENT_ENV] = originalEnvironment;
		}
	});

	it("re-resolves baseUrl when CLINE_ENVIRONMENT changes between reads", () => {
		const spec = findClineSpec();

		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.production.apiBaseUrl}/api/v1`,
		);

		process.env[CLINE_ENVIRONMENT_ENV] = "staging";
		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.staging.apiBaseUrl}/api/v1`,
		);

		process.env[CLINE_ENVIRONMENT_ENV] = "local";
		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.local.apiBaseUrl}/api/v1`,
		);

		delete process.env[CLINE_ENVIRONMENT_ENV];
		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.production.apiBaseUrl}/api/v1`,
		);
	});
});

describe("cline builtin models", () => {
	it("exposes its canonical default model ID", () => {
		expect(findClineSpec().defaultModelId).toBe(CLINE_DEFAULT_MODEL_ID);
	});

	it("prefers Vercel-style Z.ai model ids over equivalent OpenRouter ids", async () => {
		const models = await getModelsForProvider("cline");

		expect(models["zai/glm-5.2"]).toMatchObject({
			id: "zai/glm-5.2",
			name: "GLM 5.2",
			contextWindow: 1_000_000,
			maxInputTokens: 1_000_000,
		});
		expect(models["zai/glm-5.1"]).toMatchObject({
			id: "zai/glm-5.1",
		});
		expect(models["z-ai/glm-5.2"]).toBeUndefined();
	});

	it("includes Vercel-only allowlisted models the OpenRouter catalog lacks", async () => {
		const models = await getModelsForProvider("cline");

		expect(models["meta/muse-spark-1.2-contributor"]).toMatchObject({
			id: "meta/muse-spark-1.2-contributor",
			contextWindow: 1_048_576,
			pricing: expect.objectContaining({ input: 0.1, output: 0.2 }),
		});
	});

	it("excludes image-output models without changing upstream catalogs", async () => {
		const modelId = "google/gemini-3-pro-image";
		const [clineModels, openRouterModels, vercelModels] = await Promise.all([
			getModelsForProvider("cline"),
			getModelsForProvider("openrouter"),
			getModelsForProvider("vercel-ai-gateway"),
		]);

		expect(clineModels[modelId]).toBeUndefined();
		expect(
			Object.values(clineModels).some(
				(model) => model.modalities?.output.includes("image") === true,
			),
		).toBe(false);
		expect(openRouterModels[modelId]?.modalities?.output).toContain("image");
		expect(vercelModels[modelId]?.modalities?.output).toContain("image");
	});
});

describe("baked anthropic catalog reasoning options", () => {
	// Regression guard for the offline fallback: when the live models.dev
	// fetch fails, models resolve from the baked catalog. If that catalog
	// drops reasoningOptions, adaptive-era Claude models fall back to the
	// manual thinking wire shape and every reasoning request is rejected by
	// the Anthropic API.
	it("carries effort options that resolve to adaptive thinking for adaptive-era Claude models", async () => {
		const models = await getModelsForProvider("anthropic");
		const adaptiveEraModelIds = [
			"claude-sonnet-5",
			"claude-fable-5",
			"claude-opus-5",
			"claude-opus-4-8",
			"claude-opus-4-7",
			"claude-opus-4-6",
			"claude-sonnet-4-6",
		];

		for (const modelId of adaptiveEraModelIds) {
			const model = models[modelId];
			expect(model, modelId).toBeDefined();
			expect(
				model.reasoningOptions?.some((option) => option.type === "effort"),
				modelId,
			).toBe(true);

			const context: GatewayProviderContext = {
				provider: {
					id: "anthropic",
					name: "Anthropic",
					defaultModelId: modelId,
					models: [],
					metadata: {
						routing: {
							reasoning: {
								format: "anthropic-thinking",
								routes: [{ matcher: "anthropic-compatible" }],
							},
						},
					},
				},
				model: {
					id: modelId,
					name: model.name,
					providerId: "anthropic",
					reasoningOptions: model.reasoningOptions,
					metadata: model.family ? { family: model.family } : undefined,
				},
				config: { providerId: "anthropic" },
			};
			expect(
				resolveAnthropicReasoningRequestPolicy(
					{
						providerId: "anthropic",
						modelId,
						messages: [],
						reasoning: { enabled: true },
					},
					context,
				),
				modelId,
			).toEqual({ kind: "anthropic-adaptive" });
		}
	});
});

describe("vertex builtin models", () => {
	it("adds Claude Fable 5 without changing existing Vertex models", async () => {
		const models = await getModelsForProvider("vertex");
		expect(models["claude-fable-5"]).toMatchObject({
			id: "claude-fable-5",
			contextWindow: 1_000_000,
			maxInputTokens: 1_000_000,
			maxTokens: 128_000,
		});

		expect(models["claude-sonnet-5@default"]).toBeDefined();
		// The default comes from the generated (models.dev-derived) provider
		// spec and rotates as the upstream catalog changes — assert it resolves
		// to a model in the list rather than pinning a specific id.
		const provider = await getProvider("vertex");
		expect(provider.defaultModelId).toBeTruthy();
		expect(models[provider.defaultModelId ?? ""]).toBeDefined();
		expect(
			(await getModelsForProvider("gemini"))["claude-fable-5"],
		).toBeUndefined();
	});

	it("drops Anthropic's universal pricing from the Vertex Fable 5 record", async () => {
		// Vertex bills region-dependently and its US/EU multi-region rates
		// exceed Anthropic's list price; the overlay must not present a
		// misleading universal price. No pricing beats wrong pricing.
		const anthropicFable = (await getModelsForProvider("anthropic"))[
			"claude-fable-5"
		];
		expect(anthropicFable?.pricing).toBeDefined();

		const vertexFable = (await getModelsForProvider("vertex"))[
			"claude-fable-5"
		];
		expect(vertexFable).toBeDefined();
		expect(vertexFable.pricing).toBeUndefined();
		// Non-pricing metadata still carries over.
		expect(vertexFable.capabilities).toEqual(anthropicFable.capabilities);
		expect(vertexFable.reasoningOptions).toEqual(
			anthropicFable.reasoningOptions,
		);
	});
});

describe("cline-pass builtin spec", () => {
	it("registers a distinct Cline-compatible provider with a custom model list", async () => {
		const models = await getModelsForProvider("cline-pass");
		const provider = await getProvider("cline-pass");

		expect(provider).toMatchObject({
			id: "cline-pass",
			name: "ClinePass",
			baseUrl: `${CLINE_ENVIRONMENTS.production.apiBaseUrl}/api/v1`,
			client: "openai-compatible",
			capabilities: expect.arrayContaining([
				"oauth",
				"tools",
				"reasoning",
				"prompt-cache",
			]),
		});
		expect(models).toHaveProperty(provider?.defaultModelId ?? "");
		expect(Object.keys(models).length).toBeGreaterThan(0);
		for (const model of Object.values(models)) {
			expect(model.contextWindow).toBeGreaterThan(0);
			expect(model.maxInputTokens).toBeGreaterThan(0);
			expect(model.maxTokens).toBeGreaterThan(0);
			expect(model.capabilities).toEqual(expect.arrayContaining(["tools"]));
			expect(model.pricing).toBeDefined();
		}
	});
});

describe("built-in provider metadata", () => {
	it("declares OpenRouter image transport for Cline-compatible gateways", async () => {
		await expect(getProvider("cline")).resolves.toMatchObject({
			metadata: {
				imageTransport: "openrouter",
				responseEnvelope: "success-data",
			},
		});
		await expect(getProvider("cline-pass")).resolves.toMatchObject({
			metadata: {
				imageTransport: "openrouter",
				responseEnvelope: "success-data",
			},
		});
		await expect(getProvider("openrouter")).resolves.toMatchObject({
			metadata: { imageTransport: "openrouter" },
		});
	});

	it("registers ElevenLabs Scribe v2 as a dedicated transcription provider", async () => {
		await expect(getProvider("elevenlabs")).resolves.toMatchObject({
			id: "elevenlabs",
			name: "ElevenLabs",
			baseUrl: "https://api.elevenlabs.io/v1",
			defaultModelId: "scribe_v2",
			client: "fetch",
		});
		await expect(getModelsForProvider("elevenlabs")).resolves.toEqual({
			scribe_v2: expect.objectContaining({
				id: "scribe_v2",
				operation: "transcription",
				operationModes: ["batch"],
				modalities: {
					input: ["audio"],
					output: ["text"],
				},
			}),
		});
		expect(BUILTIN_PROVIDER_MANIFESTS_BY_ID.elevenlabs).toMatchObject({
			modelOperationCapabilities: [
				{
					operation: "transcription",
					modes: ["batch"],
				},
			],
			metadata: { transcriptionTransport: "elevenlabs" },
		});
		expect(BUILTIN_PROVIDER_MANIFESTS_BY_ID["vercel-ai-gateway"]).toMatchObject(
			{
				modelOperationCapabilities: expect.arrayContaining([
					expect.objectContaining({
						operation: "transcription",
						modes: ["batch", "streaming"],
					}),
				]),
				metadata: { transcriptionTransport: "vercel-ai-gateway" },
			},
		);
	});

	it("merges generated provider specs with handwritten built-in overrides", async () => {
		const generatedIds = new Set(
			GENERATED_PROVIDER_SPECS.map((spec) => spec.id),
		);
		const builtinIds = new Set(BUILTIN_SPECS.map((spec) => spec.id));

		for (const generatedId of generatedIds) {
			expect(builtinIds.has(generatedId)).toBe(true);
		}
		expect(generatedIds.has("alibaba")).toBe(true);
		expect(generatedIds.has("cohere")).toBe(false);

		await expect(getProvider("alibaba")).resolves.toMatchObject({
			id: "alibaba",
			client: "openai-compatible",
			baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		});
		await expect(getModelsForProvider("alibaba")).resolves.toHaveProperty(
			"qwen3.7-plus",
		);

		const generatedMistral = GENERATED_PROVIDER_SPECS.find(
			(spec) => spec.id === "mistral",
		);
		expect(generatedMistral).toBeDefined();
		await expect(getProvider("mistral")).resolves.toMatchObject({
			id: "mistral",
			baseUrl: "https://api.mistral.ai/v1",
			defaultModelId: generatedMistral?.defaultModelId,
			client: "ai-sdk-community",
		});
		await expect(getModelsForProvider("mistral")).resolves.toHaveProperty(
			generatedMistral?.defaultModelId ?? "",
		);
	});

	it("uses generated specs directly when no runtime override is required", () => {
		// moonshot is intentionally absent: it carries a Cline-specific
		// regional routing override (apiLineBaseUrls) on top of its generated
		// spec.
		const generatedOnlyProviderIds = [
			"fireworks",
			"poolside",
			"nebius",
			"baseten",
			"requesty",
			"huggingface",
			"wandb",
			"xiaomi",
			"tencent-tokenhub",
		] as const;

		for (const providerId of generatedOnlyProviderIds) {
			expect(BUILTIN_SPECS.find((spec) => spec.id === providerId)).toEqual(
				GENERATED_PROVIDER_SPECS.find((spec) => spec.id === providerId),
			);
		}
	});

	it("marks popular providers with a provider capability and rank", async () => {
		await expect(getProvider("cline")).resolves.toMatchObject({
			name: "Cline Usage-Billing",
			capabilities: expect.arrayContaining(["popular"]),
			metadata: { popularRank: 1 },
		});
		await expect(getProvider("zai")).resolves.not.toMatchObject({
			capabilities: expect.arrayContaining(["popular"]),
		});
	});

	it("uses the current Hugging Face router endpoint", async () => {
		await expect(getProvider("huggingface")).resolves.toMatchObject({
			baseUrl: "https://router.huggingface.co/v1",
		});
	});

	it("derives ChatGPT subscription models from the generated OpenAI catalog", async () => {
		const chatGptModels = await getModelsForProvider("openai-codex");
		const openAiModels = await getModelsForProvider("openai-native");
		const modelIds = Object.keys(chatGptModels);

		expect(modelIds).toEqual(
			expect.arrayContaining(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]),
		);
		expect(modelIds).not.toContain("gpt-5.5-pro");
		expect(modelIds).not.toContain("gpt-5.1-codex-max");
		expect(modelIds).not.toContain("gpt-5.2");
		expect(modelIds).not.toContain("gpt-5.2-codex");
		expect(modelIds).not.toContain("gpt-5.3-codex");
		expect(modelIds).not.toContain("gpt-5.3-codex-spark");
		expect(modelIds).not.toContain("gpt-5.4-nano");
		expect(modelIds).not.toContain("o3");
		expect(chatGptModels["gpt-5.5"]).toEqual(
			expect.objectContaining({
				...openAiModels["gpt-5.5"],
				// ChatGPT/Codex backend caps: 272K input at the 95% effective budget
				maxInputTokens: 272_000 * 0.95,
				contextWindow: 400_000,
				maxTokens: 128_000,
			}),
		);
		expect(chatGptModels["gpt-5.4"]).toEqual(
			expect.objectContaining({
				name: "GPT-5.4",
				maxInputTokens: expect.any(Number),
				contextWindow: expect.any(Number),
			}),
		);
	});

	it("routes native Z.AI providers through GLM thinking metadata", async () => {
		for (const providerId of ["zai", "zai-coding-plan"] as const) {
			await expect(getProvider(providerId)).resolves.toMatchObject({
				metadata: {
					routing: {
						reasoning: {
							format: "glm-thinking",
						},
					},
				},
			});

			const models = Object.values(await getModelsForProvider(providerId));
			expect(models.length).toBeGreaterThan(0);
			for (const model of models) {
				expect(model.family?.startsWith("glm")).toBe(true);
			}
		}
	});

	it("routes direct MiniMax M3 through MiniMax thinking metadata", async () => {
		await expect(getProvider("minimax")).resolves.toMatchObject({
			metadata: {
				routing: {
					reasoning: {
						format: "minimax-thinking",
						routes: [
							expect.objectContaining({
								matcher: "model-id",
								modelId: "MiniMax-M3",
							}),
						],
					},
				},
			},
		});
	});
});

describe("regional API line base URLs", () => {
	it("exposes china/international endpoints on regional provider specs", () => {
		const expectations: Record<
			string,
			{ china: string; international: string }
		> = {
			qwen: {
				china: "https://dashscope.aliyuncs.com/compatible-mode/v1",
				international: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
			},
			"qwen-code": {
				china: "https://dashscope.aliyuncs.com/compatible-mode/v1",
				international: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
			},
			moonshot: {
				china: "https://api.moonshot.cn/v1",
				international: "https://api.moonshot.ai/v1",
			},
			zai: {
				china: "https://open.bigmodel.cn/api/paas/v4",
				international: "https://api.z.ai/api/paas/v4",
			},
			"zai-coding-plan": {
				china: "https://open.bigmodel.cn/api/coding/paas/v4",
				international: "https://api.z.ai/api/coding/paas/v4",
			},
			minimax: {
				china: "https://api.minimaxi.com/anthropic/v1",
				international: "https://api.minimax.io/anthropic/v1",
			},
		};

		for (const [providerId, expected] of Object.entries(expectations)) {
			const spec = BUILTIN_SPECS.find((s) => s.id === providerId);
			expect(spec?.apiLineBaseUrls, providerId).toEqual(expected);
		}
	});

	it("resolves the regional base URL for a selected api line", () => {
		expect(resolveProviderApiLineBaseUrl("zai", "china")).toBe(
			"https://open.bigmodel.cn/api/paas/v4",
		);
		expect(resolveProviderApiLineBaseUrl("moonshot", "china")).toBe(
			"https://api.moonshot.cn/v1",
		);
		expect(resolveProviderApiLineBaseUrl("qwen", "international")).toBe(
			"https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		);
	});

	it("returns undefined for unknown lines and non-regional providers", () => {
		expect(resolveProviderApiLineBaseUrl("zai", undefined)).toBeUndefined();
		expect(resolveProviderApiLineBaseUrl("zai", "mars")).toBeUndefined();
		expect(resolveProviderApiLineBaseUrl("anthropic", "china")).toBeUndefined();
	});

	it("keeps the international line consistent with the spec default base URL for zai and moonshot", () => {
		for (const providerId of ["zai", "moonshot", "minimax"]) {
			const spec = BUILTIN_SPECS.find((s) => s.id === providerId);
			expect(spec?.apiLineBaseUrls?.international, providerId).toBe(
				spec?.defaults?.baseUrl,
			);
		}
	});
});
