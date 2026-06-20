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

	it("prefers Vercel-style Z.ai ids in Cline known models", async () => {
		const resolved = await resolveProviderConfig("cline");

		expect(resolved?.knownModels?.["zai/glm-5.2"]).toMatchObject({
			id: "zai/glm-5.2",
			name: "GLM 5.2",
			contextWindow: 1_000_000,
			maxInputTokens: 1_000_000,
		});
		expect(resolved?.knownModels?.["z-ai/glm-5.2"]).toBeUndefined();
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
								"gpt-5.4-live": {
									name: "GPT-5.4 Live",
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
		expect(resolved?.knownModels?.["gpt-5.4-live"]).toBeUndefined();
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

	it("derives ChatGPT subscription models from the generated OpenAI catalog", async () => {
		const resolved = await resolveProviderConfig("openai-codex");
		const openAiResolved = await resolveProviderConfig("openai-native");
		const modelIds = Object.keys(resolved?.knownModels ?? {});

		expect(modelIds).toEqual(
			expect.arrayContaining(["gpt-5.5", "gpt-5.5-pro", "gpt-5.4"]),
		);
		expect(modelIds).not.toContain("gpt-5.1-codex-max");
		expect(modelIds).not.toContain("gpt-5.2-codex");
		expect(modelIds).not.toContain("gpt-5.4-nano");
		expect(modelIds).not.toContain("o3");
		expect(resolved?.knownModels?.["gpt-5.4"]).toBeDefined();
		expect(resolved?.knownModels?.["gpt-5.5"]).toEqual(
			expect.objectContaining({
				...openAiResolved?.knownModels?.["gpt-5.5"],
				maxInputTokens: 272_000,
				contextWindow: 400_000,
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
				maxInputTokens: 272_000,
				contextWindow: 400_000,
			}),
		);
		expect(resolved?.knownModels?.["gpt-5.4-nano"]).toBeUndefined();
	});
});
