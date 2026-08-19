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
	it("builds model ids from the server-filtered catalog", () => {
		const catalog = buildProviderModelCatalog([
			provider([
				{ id: "legacy", name: "Legacy" },
				{
					id: "mixed",
					name: "Mixed",
					inputModalities: ["text", "image"],
					outputModalities: ["text", "image"],
					supportsReasoning: true,
				},
			]),
		]);

		expect(catalog.enabledProviderIds).toEqual(["test"]);
		expect(catalog.providerModels.test).toEqual(["legacy", "mixed"]);
		expect(catalog.providerReasoningModels.test).toEqual(["mixed"]);
	});

	it("omits enabled providers with no models", () => {
		const catalog = buildProviderModelCatalog([provider([])]);

		expect(catalog.enabledProviderIds).toEqual([]);
		expect(catalog.providerModels.test).toEqual([]);
	});
});
