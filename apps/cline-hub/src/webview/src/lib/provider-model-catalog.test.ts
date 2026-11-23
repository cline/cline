import { describe, expect, it } from "vitest";
import { buildProviderModelCatalog } from "./provider-model-catalog";
import type { Provider } from "./provider-schema";

function provider(modelList: NonNullable<Provider["modelList"]>): Provider {
	return {
		id: "test",
		name: "Test",
		models: modelList.length,
		color: "#000000",
		letter: "T",
		enabled: true,
		modelList,
	};
}

describe("buildProviderModelCatalog", () => {
	it("keeps legacy and mixed chat models while excluding dedicated media endpoints", () => {
		const catalog = buildProviderModelCatalog([
			provider([
				{ id: "legacy", name: "Legacy" },
				{
					id: "operation-only-transcription",
					name: "Operation-only Transcription",
					operation: "transcription",
				},
				{
					id: "mixed",
					name: "Mixed",
					inputModalities: ["text", "image"],
					outputModalities: ["text", "image"],
					supportsReasoning: true,
				},
				{
					id: "transcription",
					name: "Transcription",
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
				{
					id: "image",
					name: "Image",
					inputModalities: ["text"],
					outputModalities: ["image"],
				},
				{
					id: "image-operation",
					name: "Image Operation",
					operation: "image-generation",
				},
			]),
		]);

		expect(catalog.enabledProviderIds).toEqual(["test"]);
		expect(catalog.providerModels.test).toEqual(["legacy", "mixed"]);
		expect(catalog.providerReasoningModels.test).toEqual(["mixed"]);
	});

	it("omits enabled providers with no chat-compatible models", () => {
		const catalog = buildProviderModelCatalog([
			provider([
				{
					id: "speech",
					name: "Speech",
					inputModalities: ["text"],
					outputModalities: ["audio"],
				},
			]),
		]);

		expect(catalog.enabledProviderIds).toEqual([]);
		expect(catalog.providerModels.test).toEqual([]);
	});
});
