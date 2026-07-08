import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearLiveModelsCatalogCache,
	clearPrivateModelsCatalogCache,
	resolveProviderConfig,
} from "./provider-defaults";

afterEach(() => {
	clearLiveModelsCatalogCache();
	clearPrivateModelsCatalogCache();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("resolveProviderConfig", () => {
	it("returns bundled models for built-in providers without a base URL", async () => {
		const resolved = await resolveProviderConfig("bedrock");

		expect(resolved?.baseUrl).toBeUndefined();
		expect(resolved?.modelId).toBe("minimax.minimax-m2.5");
		expect(resolved?.knownModels?.["amazon.nova-2-lite-v1:0"]?.name).toBe(
			"Nova 2 Lite",
		);
		expect(Object.keys(resolved?.knownModels ?? {}).length).toBeGreaterThan(0);
	});

	it("uses catalog aliases when loading live models", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						openrouter: {
							models: {
								"vendor/live-only-model": {
									name: "Live Only Model",
									tool_call: true,
								},
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);

		const resolved = await resolveProviderConfig("cline", {
			loadLatestOnInit: true,
			failOnError: false,
			cacheTtlMs: 0,
		});

		expect(resolved?.knownModels?.["vendor/live-only-model"]?.name).toBe(
			"Live Only Model",
		);
	});

	it("uses only live Cline recommended models for ClinePass when live models are found", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url === "https://models.test/api.json") {
				return new Response(
					JSON.stringify({
						openrouter: {
							models: {
								"vendor/live-pass-model": {
									name: "Live Pass Model",
									tool_call: true,
									reasoning: true,
									limit: { context: 256_000, input: 200_000, output: 32_000 },
								},
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}

			return new Response(
				JSON.stringify({
					clinePass: [
						{
							id: "cline-pass/live-pass-model",
							name: "vendor/live-pass-model",
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig("cline-pass", {
			loadLatestOnInit: true,
			failOnError: false,
			cacheTtlMs: 0,
			url: "https://models.test/api.json",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(resolved?.knownModels?.["cline-pass/live-pass-model"]).toMatchObject(
			{
				id: "cline-pass/live-pass-model",
				name: "Live Pass Model",
				contextWindow: 256_000,
				maxInputTokens: 200_000,
				maxTokens: 32_000,
			},
		);
		expect(resolved?.knownModels?.["cline-pass/mimo-v2.5-pro"]).toBeUndefined();
	});

	it("falls back to generated ClinePass models when no live ClinePass models are found", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url === "https://models.test/api.json") {
				return new Response(
					JSON.stringify({
						openrouter: {
							models: {
								"vendor/live-openrouter-model": {
									name: "Live OpenRouter Model",
									tool_call: true,
								},
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}

			return new Response(JSON.stringify({ clinePass: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig("cline-pass", {
			loadLatestOnInit: true,
			failOnError: false,
			cacheTtlMs: 0,
			url: "https://models.test/api.json",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(resolved?.knownModels?.["cline-pass/mimo-v2.5-pro"]?.name).toBe(
			"MiMo-V2.5-Pro",
		);
		expect(
			resolved?.knownModels?.["vendor/live-openrouter-model"],
		).toBeUndefined();
	});

	it("prefers Vercel-style Z.ai ids in Cline known models", async () => {
		const resolved = await resolveProviderConfig("cline");

		expect(resolved?.knownModels?.["zai/glm-5.2"]).toMatchObject({
			id: "zai/glm-5.2",
			name: "GLM 5.2",
			contextWindow: 1_040_000,
			maxInputTokens: 1_040_000,
		});
		expect(resolved?.knownModels?.["z-ai/glm-5.2"]).toBeUndefined();
	});

	it("preserves explicit Cline known model overrides for alias ids", async () => {
		const resolved = await resolveProviderConfig("cline", undefined, {
			providerId: "cline",
			modelId: "z-ai/glm-5.2",
			knownModels: {
				"z-ai/glm-5.2": {
					id: "z-ai/glm-5.2",
					name: "Custom GLM 5.2",
					contextWindow: 123_456,
					maxInputTokens: 123_456,
				},
			},
		});

		expect(resolved?.knownModels?.["z-ai/glm-5.2"]).toMatchObject({
			id: "z-ai/glm-5.2",
			name: "Custom GLM 5.2",
			contextWindow: 123_456,
			maxInputTokens: 123_456,
		});
		expect(resolved?.knownModels?.["zai/glm-5.2"]).toMatchObject({
			id: "zai/glm-5.2",
			contextWindow: 1_040_000,
			maxInputTokens: 1_040_000,
		});
	});

	it("uses the live OpenAI catalog for ChatGPT subscription models", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						openai: {
							models: {
								"gpt-5.6-live": {
									name: "GPT-5.6 Live",
									tool_call: true,
									reasoning: true,
									family: "gpt",
									release_date: "2027-01-01",
								},
								"gpt-5.3-live": {
									name: "GPT-5.3 Live",
									tool_call: true,
									reasoning: true,
									family: "gpt",
									release_date: "2027-01-02",
								},
								"gpt-5.4-nano": {
									name: "GPT-5.4 nano",
									tool_call: true,
									reasoning: true,
									family: "gpt-nano",
									release_date: "2027-01-03",
								},
								"o-live": {
									name: "o live",
									tool_call: true,
									reasoning: true,
									family: "o",
									release_date: "2027-01-04",
								},
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);

		const resolved = await resolveProviderConfig("openai-codex", {
			loadLatestOnInit: true,
			failOnError: false,
			cacheTtlMs: 0,
			url: "https://models.test/api.json",
		});

		expect(resolved?.knownModels?.["gpt-5.6-live"]?.name).toBe("GPT-5.6 Live");
		expect(resolved?.knownModels?.["gpt-5.3-live"]).toBeUndefined();
		expect(resolved?.knownModels?.["gpt-5.4-nano"]).toBeUndefined();
		expect(resolved?.knownModels?.["o-live"]).toBeUndefined();
	});

	it("uses built-in modelsSourceUrl for keyless local provider models", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({ models: [{ name: "local-llama" }] }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"ollama",
			{ failOnError: false, cacheTtlMs: 0 },
			{
				providerId: "ollama",
				modelId: "",
				baseUrl: "http://tailscale-host:11434/v1",
			},
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"http://tailscale-host:11434/api/tags",
			{ method: "GET" },
		);
		expect(Object.keys(resolved?.knownModels ?? {})).toEqual(["local-llama"]);
	});

	it("loads Poolside models from the authenticated models endpoint", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "poolside/laguna-xs.2",
							name: "Poolside: Laguna XS.2",
							description: "Poolside coding model",
							context_length: 131_072,
							max_completion_tokens: 8192,
							supported_features: ["tools", "reasoning"],
							supported_sampling_parameters: ["temperature"],
							input_modalities: ["text"],
							pricing: { prompt: "0", completion: "0" },
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"poolside",
			{ failOnError: true, cacheTtlMs: 0 },
			{
				providerId: "poolside",
				modelId: "poolside/laguna-m.1",
				apiKey: "poolside-key",
				baseUrl: "https://inference.poolside.ai/v1",
			},
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://inference.poolside.ai/v1/models",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer poolside-key",
				}),
			}),
		);
		expect(resolved?.knownModels?.["poolside/laguna-xs.2"]).toEqual(
			expect.objectContaining({
				name: "Poolside: Laguna XS.2",
				contextWindow: 131_072,
				maxInputTokens: 131_072,
				maxTokens: 8192,
				capabilities: expect.arrayContaining([
					"streaming",
					"tools",
					"reasoning",
					"temperature",
				]),
				pricing: { input: 0, output: 0 },
				status: "active",
			}),
		);
	});

	it("falls back to /model/info for LiteLLM private models", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("no v1 route", { status: 404 }))
			.mockResolvedValueOnce(new Response("no v1 route", { status: 404 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [
							{
								model_name: "private-proxy-model",
								litellm_params: { model: "openai/gpt-4o-mini" },
								model_info: {
									supports_vision: true,
									supports_reasoning: true,
								},
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"litellm",
			{ failOnError: true, cacheTtlMs: 0 },
			{
				providerId: "litellm",
				modelId: "",
				apiKey: "litellm-key",
				baseUrl: "http://localhost:4000/v1/",
			},
		);

		expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
			"http://localhost:4000/v1/model/info",
			"http://localhost:4000/v1/model/info",
			"http://localhost:4000/model/info",
		]);
		expect(resolved?.knownModels?.["openai/gpt-4o-mini"]).toEqual(
			expect.objectContaining({
				name: "private-proxy-model",
				capabilities: expect.arrayContaining(["images", "reasoning"]),
			}),
		);
		expect(resolved?.knownModels?.["private-proxy-model"]).toEqual(
			expect.objectContaining({
				name: "private-proxy-model",
				capabilities: expect.arrayContaining(["images", "reasoning"]),
			}),
		);
		expect(Object.keys(resolved?.knownModels ?? {}).sort()).toEqual([
			"openai/gpt-4o-mini",
			"private-proxy-model",
		]);
		expect(resolved?.knownModels?.["gpt-5.4"]).toBeUndefined();
	});

	it("returns an empty authoritative LiteLLM model list without auth", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"litellm",
			{ failOnError: true, cacheTtlMs: 0 },
			{
				providerId: "litellm",
				modelId: "",
				baseUrl: "http://localhost:4000/v1/",
			},
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(resolved?.knownModels).toEqual({});
		expect(resolved?.knownModels?.["gpt-5.4"]).toBeUndefined();
	});

	it("does not fall back to bundled LiteLLM models when private model fetch fails non-strictly", async () => {
		const fetchMock = vi.fn(
			async () => new Response('{"error":"unauthorized"}', { status: 401 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"litellm",
			{ failOnError: false, cacheTtlMs: 0 },
			{
				providerId: "litellm",
				modelId: "",
				apiKey: "litellm-key",
				baseUrl: "http://localhost:4000",
			},
		);

		expect(fetchMock).toHaveBeenCalled();
		expect(resolved?.knownModels).toEqual({});
		expect(resolved?.knownModels?.["gpt-5.4"]).toBeUndefined();
	});

	it("reports attempted path, auth header, status, and body for LiteLLM model fetch failures", async () => {
		const fetchMock = vi.fn(
			async () => new Response('{"error":"unauthorized"}', { status: 401 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			resolveProviderConfig(
				"litellm",
				{ failOnError: true, cacheTtlMs: 0 },
				{
					providerId: "litellm",
					modelId: "",
					apiKey: "litellm-key",
					baseUrl: "http://localhost:4000",
				},
			),
		).rejects.toThrow(
			'/model/info (Authorization): HTTP 401: {"error":"unauthorized"}',
		);
	});

	it("derives ChatGPT subscription models from the generated OpenAI catalog", async () => {
		const resolved = await resolveProviderConfig("openai-codex");
		const openAiResolved = await resolveProviderConfig("openai-native");
		const modelIds = Object.keys(resolved?.knownModels ?? {});

		expect(modelIds).toEqual(expect.arrayContaining(["gpt-5.5", "gpt-5.4"]));
		expect(modelIds).not.toContain("gpt-5.5-pro");
		expect(modelIds).not.toContain("gpt-5.1-codex-max");
		expect(modelIds).not.toContain("gpt-5.2-codex");
		expect(modelIds).not.toContain("gpt-5.4-nano");
		expect(modelIds).not.toContain("o3");
		expect(resolved?.knownModels?.["gpt-5.4"]).toBeDefined();
		expect(resolved?.knownModels?.["gpt-5.5"]).toEqual(
			expect.objectContaining({
				...openAiResolved?.knownModels?.["gpt-5.5"],
				// ChatGPT/Codex backend caps: 272K input at the 95% effective budget
				maxInputTokens: 272_000 * 0.95,
				contextWindow: 400_000,
				maxTokens: 128_000,
			}),
		);
	});

	it("resolves ChatGPT OAuth models from the filtered catalog", async () => {
		const resolved = await resolveProviderConfig(
			"openai-codex",
			{ cacheTtlMs: 1 },
			{
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				apiKey: "oauth-token",
				accountId: "acct_123",
			},
		);

		expect(Object.keys(resolved?.knownModels ?? {})).toEqual(
			expect.arrayContaining(["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]),
		);
		expect(resolved?.knownModels?.["gpt-5.4-mini"]).toEqual(
			expect.objectContaining({
				name: "GPT-5.4 mini",
				// catalog input cap scaled to the 95% effective Codex budget
				maxInputTokens: 272_000 * 0.95,
				contextWindow: 400_000,
			}),
		);
		expect(resolved?.knownModels?.["gpt-5.4-nano"]).toBeUndefined();
	});
});
