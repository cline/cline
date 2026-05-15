import { describe, expect, it, vi } from "vitest";
import {
	getGeneratedModelsForProvider,
	getGeneratedProviderModels,
} from "./catalog.generated-access";
import {
	fetchModelsDevProviderModels,
	type ModelsDevPayload,
	normalizeModelsDevProviderModels,
	resolveMaxInputTokens,
} from "./catalog-live";

describe("models-dev-catalog", () => {
	it("uses input limits as the model request context window", () => {
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

	it("discounts max output tokens only when the raw context limit matches output", () => {
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
		).toBe(204);
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
					maxInputTokens: 4096,
					maxTokens: 204,
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
					maxInputTokens: 4096,
					maxTokens: 204,
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
