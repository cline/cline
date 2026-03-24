import { describe, expect, it, vi } from "vitest";
import {
	fetchModelsDevProviderModels,
	type ModelsDevPayload,
	normalizeModelsDevProviderModels,
} from "./models-dev-catalog";

describe("models-dev-catalog", () => {
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
						cost: { input: 1, output: 2, cache_read: 0.5, cache_write: 0.8 },
						status: "preview",
					},
					"gpt-no-tools": {
						name: "GPT No Tools",
						tool_call: false,
					},
					"gpt-deprecated": {
						name: "GPT Deprecated",
						tool_call: true,
						status: "deprecated",
					},
				},
			},
			anthropic: {
				models: {
					"claude-defaults": {
						tool_call: true,
						status: "experimental",
						release_date: "2025-02-01",
					},
					"claude-older": {
						tool_call: true,
						release_date: "2024-02-01",
					},
				},
			},
		};

		const providerModels = normalizeModelsDevProviderModels(payload, {
			openai: "openai-native",
			anthropic: "anthropic",
		});

		expect(providerModels).toEqual({
			"openai-native": {
				"gpt-live": {
					id: "gpt-live",
					name: "GPT Live",
					contextWindow: 1_000_000,
					maxTokens: 4096,
					capabilities: [
						"images",
						"tools",
						"reasoning",
						"structured_output",
						"temperature",
					],
					pricing: {
						input: 1,
						output: 2,
						cacheRead: 0.5,
						cacheWrite: 0.8,
					},
					status: "preview",
					releaseDate: "2026-01-01",
				},
			},
			anthropic: {
				"claude-defaults": {
					id: "claude-defaults",
					name: "claude-defaults",
					contextWindow: 4096,
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
				},
				"claude-older": {
					id: "claude-older",
					name: "claude-older",
					contextWindow: 4096,
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
			{ openai: "openai-native" },
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
				{ openai: "openai-native" },
				fetcher as unknown as typeof fetch,
			),
		).rejects.toThrow(
			"Failed to load model catalog from https://models.dev/api.json: HTTP 503",
		);
	});
});
