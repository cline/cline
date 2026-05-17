import * as Llms from "@cline/llms";
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

	it("does not expose generic OpenAI models for OpenAI Codex OAuth fallback", async () => {
		const resolved = await resolveProviderConfig("openai-codex");

		expect(Object.keys(resolved?.knownModels ?? {}).sort()).toEqual([
			"gpt-5-codex",
			"gpt-5.1-codex",
			"gpt-5.1-codex-max",
			"gpt-5.1-codex-mini",
			"gpt-5.2",
			"gpt-5.2-codex",
			"gpt-5.3-codex",
			"gpt-5.3-codex-spark",
			"gpt-5.4",
			"gpt-5.4-mini",
		]);
		expect(resolved?.knownModels?.["gpt-5.4"]).toBeDefined();
		expect(resolved?.knownModels?.["gpt-5.4-nano"]).toBeUndefined();
	});

	it("merges OpenAI Codex account models into the ChatGPT OAuth fallback list", async () => {
		const listModels = vi
			.spyOn(Llms, "listOpenAICodexModels")
			.mockResolvedValue([
				{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
				{ id: "gpt-5.4", name: "GPT-5.4" },
				{ id: "gpt-5.4-mini", name: "gpt-5.4-mini" },
				{ id: "account-only-codex", name: "Account Only Codex" },
			]);

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

		expect(listModels).toHaveBeenCalledWith(
			expect.objectContaining({
				accessToken: "oauth-token",
				accountId: "acct_123",
			}),
		);
		expect(Object.keys(resolved?.knownModels ?? {}).sort()).toEqual([
			"account-only-codex",
			"gpt-5-codex",
			"gpt-5.1-codex",
			"gpt-5.1-codex-max",
			"gpt-5.1-codex-mini",
			"gpt-5.2",
			"gpt-5.2-codex",
			"gpt-5.3-codex",
			"gpt-5.3-codex-spark",
			"gpt-5.4",
			"gpt-5.4-mini",
		]);
		expect(resolved?.knownModels?.["gpt-5.4-mini"]).toEqual(
			expect.objectContaining({
				name: "gpt-5.4-mini",
				maxInputTokens: 272_000,
				contextWindow: 400_000,
			}),
		);
		expect(resolved?.knownModels?.["gpt-5.4-nano"]).toBeUndefined();
	});
});
