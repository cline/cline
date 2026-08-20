import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as LlmsModels from "@cline/llms";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetClineRecommendedModelsCacheForTests } from "../llms/cline-recommended-models";
import { clearLiveModelsCatalogCache } from "../llms/provider-defaults";
import { ProviderSettingsManager } from "../storage/provider-settings-manager";
import { listLocalProviders } from "./local-provider-service";
import {
	buildMediaGenerationModelCatalog,
	clearMediaGenerationSelections,
	generateConfiguredMedia,
	isUsableImageGenerationModel,
	resolveActiveMediaGenerationSettings,
	resolveConfiguredMediaGenerationTarget,
	saveMediaGenerationSettings,
} from "./media-generation-service";

function makeTempManager(): {
	manager: ProviderSettingsManager;
	cleanup: () => void;
} {
	const dir = mkdtempSync(
		path.join(os.tmpdir(), "media-generation-service-test-"),
	);
	const manager = new ProviderSettingsManager({
		filePath: path.join(dir, "providers.json"),
	});
	return {
		manager,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

afterEach(() => {
	clearLiveModelsCatalogCache();
	resetClineRecommendedModelsCacheForTests();
	LlmsModels.resetRegistry();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("media generation settings", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(() => {
		({ manager, cleanup } = makeTempManager());
		manager.saveProviderSettings(
			{
				provider: "openrouter",
				apiKey: "openrouter-key",
			},
			{ setLastUsed: false },
		);
		LlmsModels.registerProvider({
			provider: {
				id: "custom-image-provider",
				name: "Custom Image Provider",
				defaultModelId: "custom-image-model",
				client: "custom",
				source: "file",
			},
			models: {
				"custom-image-model": {
					id: "custom-image-model",
					name: "Custom Image Model",
					operation: "image-generation",
					modalities: { input: ["text"], output: ["image"] },
				},
			},
		});
		manager.saveProviderSettings(
			{
				provider: "custom-image-provider",
				apiKey: "custom-key",
			},
			{ setLastUsed: false },
		);
		LlmsModels.registerModel("openrouter", "test-image-model", {
			id: "test-image-model",
			name: "Test Image Model",
			operation: "image-generation",
			modalities: { input: ["text", "image"], output: ["image"] },
		});
		LlmsModels.registerModel("openrouter", "test-mixed-image-model", {
			id: "test-mixed-image-model",
			name: "Test Mixed Image Model",
			operation: "language",
			modalities: {
				input: ["text", "image"],
				output: ["text", "image"],
			},
		});
		LlmsModels.registerModel("openrouter", "test-stale-image-model", {
			id: "test-stale-image-model",
			name: "Test Image Model With Stale Modalities",
			operation: "image-generation",
			modalities: { input: ["text"], output: ["text"] },
		});
	});

	afterEach(() => cleanup());

	it("requires text-to-image semantics and an executable provider operation", () => {
		expect(
			isUsableImageGenerationModel("openrouter", {
				id: "dedicated",
				name: "Dedicated",
				operation: "image-generation",
				modalities: { input: ["text"], output: ["image"] },
			}),
		).toBe(true);
		expect(
			isUsableImageGenerationModel("openrouter", {
				id: "dedicated-stale-modalities",
				name: "Dedicated With Stale Modalities",
				operation: "image-generation",
				modalities: { input: ["text"], output: ["text"] },
			}),
		).toBe(true);
		expect(
			isUsableImageGenerationModel("openrouter", {
				id: "mixed",
				name: "Mixed",
				operation: "language",
				modalities: {
					input: ["text", "image"],
					output: ["text", "image"],
				},
			}),
		).toBe(true);
		expect(
			isUsableImageGenerationModel("openrouter", {
				id: "image-input-only",
				name: "Image Input Only",
				operation: "language",
				modalities: { input: ["text", "image"], output: ["text"] },
			}),
		).toBe(false);
		expect(
			isUsableImageGenerationModel("custom-provider", {
				id: "unregistered-operation",
				name: "Unregistered Operation",
				operation: "image-generation",
				modalities: { input: ["text"], output: ["image"] },
			}),
		).toBe(false);
	});

	it("persists and returns a configured image model", async () => {
		await expect(
			saveMediaGenerationSettings(manager, "image", {
				providerId: "openrouter",
				modelId: "test-image-model",
			}),
		).resolves.toMatchObject({
			mediaGeneration: {
				image: {
					providerId: "openrouter",
					modelId: "test-image-model",
				},
			},
		});

		expect(manager.getMediaGenerationSettings()).toEqual({
			image: {
				providerId: "openrouter",
				modelId: "test-image-model",
			},
		});
		await expect(listLocalProviders(manager)).resolves.toMatchObject({
			mediaGeneration: {
				image: {
					providerId: "openrouter",
					modelId: "test-image-model",
				},
			},
		});
	});

	it("returns the authoritative image model catalog for every provider", async () => {
		const catalog = await listLocalProviders(manager);

		expect(Object.keys(catalog.mediaGenerationModels.image).sort()).toEqual(
			catalog.providers.map((provider) => provider.id).sort(),
		);
		expect(catalog.mediaGenerationModels.image.openrouter).toEqual(
			expect.arrayContaining([
				"test-image-model",
				"test-mixed-image-model",
				"test-stale-image-model",
			]),
		);
		expect(
			catalog.providers
				.find((provider) => provider.id === "custom-image-provider")
				?.modelList?.map((model) => model.id),
		).toContain("custom-image-model");
		expect(
			catalog.mediaGenerationModels.image["custom-image-provider"],
		).toEqual([]);
	});

	it("accepts a mixed language model that produces images", async () => {
		await expect(
			saveMediaGenerationSettings(manager, "image", {
				providerId: "openrouter",
				modelId: "test-mixed-image-model",
			}),
		).resolves.toMatchObject({
			mediaGeneration: {
				image: { modelId: "test-mixed-image-model" },
			},
		});
	});

	it("accepts an explicit image model when modality metadata is stale", async () => {
		await expect(
			saveMediaGenerationSettings(manager, "image", {
				providerId: "openrouter",
				modelId: "test-stale-image-model",
			}),
		).resolves.toMatchObject({
			mediaGeneration: {
				image: { modelId: "test-stale-image-model" },
			},
		});
	});

	it("generates with the configured model and returns canonical media content", async () => {
		await saveMediaGenerationSettings(manager, "image", {
			providerId: "openrouter",
			modelId: "test-image-model",
		});
		const generatedImage = {
			id: "generated-1",
			modality: "image" as const,
			mediaType: "image/png",
			source: { type: "base64" as const, data: "aGVsbG8=" },
		};
		const generateSpy = vi
			.spyOn(LlmsModels, "generateMedia")
			.mockResolvedValue({
				media: [generatedImage],
				usage: {
					inputTokens: 11,
					outputTokens: 4,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		const abortController = new AbortController();

		const result = await generateConfiguredMedia(manager, {
			mediaType: "image",
			prompt: "A tiny lighthouse in a storm",
			abortSignal: abortController.signal,
		});

		expect(generateSpy).toHaveBeenCalledWith({
			providerConfig: expect.objectContaining({
				providerId: "openrouter",
				apiKey: "openrouter-key",
				modelId: "test-image-model",
				modelInfo: expect.objectContaining({ id: "test-image-model" }),
			}),
			modelId: "test-image-model",
			prompt: "A tiny lighthouse in a storm",
			mediaType: "image",
			abortSignal: abortController.signal,
		});
		expect(result).toEqual({
			content: [
				{
					type: "text",
					text: "Generated 1 image with openrouter/test-image-model.",
				},
				{ type: "media", media: generatedImage },
			],
			usage: {
				inputTokens: 11,
				outputTokens: 4,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		});
		expect(JSON.stringify(result)).not.toContain("openrouter-key");
	});

	it("resolves only currently executable stored media targets", async () => {
		manager.setMediaGenerationSettings({
			image: {
				providerId: "openrouter",
				modelId: "test-image-model",
			},
		});
		await expect(
			resolveConfiguredMediaGenerationTarget(manager, "image"),
		).resolves.toMatchObject({
			mediaType: "image",
			selection: {
				providerId: "openrouter",
				modelId: "test-image-model",
			},
			providerConfig: {
				providerId: "openrouter",
				apiKey: "openrouter-key",
				modelId: "test-image-model",
			},
			model: { id: "test-image-model" },
		});

		const unsupportedSelection = {
			image: {
				providerId: "custom-image-provider",
				modelId: "custom-image-model",
			},
		};
		manager.setMediaGenerationSettings(unsupportedSelection);
		await expect(
			resolveConfiguredMediaGenerationTarget(manager, "image"),
		).resolves.toBeUndefined();
		expect(manager.getMediaGenerationSettings()).toEqual(unsupportedSelection);
	});

	it("revalidates a stored image model before generation", async () => {
		manager.setMediaGenerationSettings({
			image: {
				providerId: "openrouter",
				modelId: "missing-image-model",
			},
		});
		const generateSpy = vi.spyOn(LlmsModels, "generateMedia");

		await expect(
			generateConfiguredMedia(manager, {
				mediaType: "image",
				prompt: "This must not be sent",
			}),
		).rejects.toThrow(
			"The configured image generation provider or model is unavailable",
		);
		expect(generateSpy).not.toHaveBeenCalled();
	});

	it("rejects a model that cannot generate images without replacing settings", async () => {
		await saveMediaGenerationSettings(manager, "image", {
			providerId: "openrouter",
			modelId: "test-image-model",
		});
		LlmsModels.registerModel("openrouter", "text-only-model", {
			id: "text-only-model",
			name: "Text Only",
			operation: "language",
			modalities: { input: ["text"], output: ["text"] },
		});

		await expect(
			saveMediaGenerationSettings(manager, "image", {
				providerId: "openrouter",
				modelId: "text-only-model",
			}),
		).rejects.toThrow(
			'not an executable image-generation model for provider "openrouter"',
		);
		expect(manager.getMediaGenerationSettings()?.image?.modelId).toBe(
			"test-image-model",
		);
	});

	it("clears media generation settings when the image selection is omitted", async () => {
		await saveMediaGenerationSettings(manager, "image", {
			providerId: "openrouter",
			modelId: "test-image-model",
		});

		await expect(
			saveMediaGenerationSettings(manager, "image", undefined),
		).resolves.toEqual({
			settingsPath: manager.getFilePath(),
			mediaGeneration: undefined,
		});
		expect(manager.getMediaGenerationSettings()).toBeUndefined();
	});

	it("updates one media type without replacing future media selections", async () => {
		manager.setMediaGenerationSettings({
			audio: {
				providerId: "future-audio-provider",
				modelId: "future-audio-model",
			},
		});

		await saveMediaGenerationSettings(manager, "image", {
			providerId: "openrouter",
			modelId: "test-image-model",
		});
		expect(manager.getMediaGenerationSettings()).toEqual({
			audio: {
				providerId: "future-audio-provider",
				modelId: "future-audio-model",
			},
			image: {
				providerId: "openrouter",
				modelId: "test-image-model",
			},
		});

		await saveMediaGenerationSettings(manager, "image", undefined);
		expect(manager.getMediaGenerationSettings()).toEqual({
			audio: {
				providerId: "future-audio-provider",
				modelId: "future-audio-model",
			},
		});
	});
});

describe("media generation service contracts", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(() => {
		({ manager, cleanup } = makeTempManager());
		manager.saveProviderSettings(
			{ provider: "openrouter", apiKey: "openrouter-key" },
			{ setLastUsed: false },
		);
		LlmsModels.registerModel("openrouter", "test-image-model", {
			id: "test-image-model",
			name: "Test Image Model",
			operation: "image-generation",
			modalities: { input: ["text", "image"], output: ["image"] },
		});
	});

	afterEach(() => cleanup());

	it("builds a sorted per-provider image catalog and fails closed for unknown providers", () => {
		const catalog = buildMediaGenerationModelCatalog([
			{
				providerId: "openrouter",
				models: {
					"z-image": {
						id: "z-image",
						name: "Z Image",
						operation: "image-generation",
						modalities: { input: ["text"], output: ["image"] },
					},
					"a-image": {
						id: "a-image",
						name: "A Image",
						operation: "image-generation",
						modalities: { input: ["text"], output: ["image"] },
					},
					"text-only": {
						id: "text-only",
						name: "Text Only",
						operation: "language",
						modalities: { input: ["text"], output: ["text"] },
					},
				},
			},
			{
				providerId: "unknown-provider",
				models: {
					advertised: {
						id: "advertised",
						name: "Advertised",
						operation: "image-generation",
						modalities: { input: ["text"], output: ["image"] },
					},
				},
			},
		]);

		expect(catalog).toEqual({
			audio: {},
			image: {
				openrouter: ["a-image", "z-image"],
				"unknown-provider": [],
			},
			video: {},
		});
	});

	it("resolves active settings only when the provider is enabled in the caller's view", async () => {
		manager.setMediaGenerationSettings({
			image: { providerId: "openrouter", modelId: "test-image-model" },
		});

		await expect(
			resolveActiveMediaGenerationSettings(manager, new Set(["openrouter"])),
		).resolves.toEqual({
			image: { providerId: "openrouter", modelId: "test-image-model" },
		});
		await expect(
			resolveActiveMediaGenerationSettings(manager, new Set()),
		).resolves.toBeUndefined();
	});

	it("clears only the selections owned by the removed provider", () => {
		manager.setMediaGenerationSettings({
			image: { providerId: "openrouter", modelId: "test-image-model" },
			audio: { providerId: "other-provider", modelId: "other-model" },
		});
		const state = manager.read();

		expect(clearMediaGenerationSelections(state, "unrelated")).toBe(false);
		expect(clearMediaGenerationSelections(state, "openrouter")).toBe(true);
		expect(state.modes.mediaGeneration).toEqual({
			audio: { providerId: "other-provider", modelId: "other-model" },
		});

		expect(clearMediaGenerationSelections(state, "other-provider")).toBe(true);
		expect(state.modes.mediaGeneration).toBeUndefined();
	});
});
