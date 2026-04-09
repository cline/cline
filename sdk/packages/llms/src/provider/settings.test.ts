import { resolveProviderModelCatalogKeys } from "@clinebot/shared";
import { describe, expect, it } from "vitest";
import { getGeneratedModelsForProvider } from "../model/catalog.generated-access";
import type { ProviderSettings } from "./settings";
import { toProviderConfig } from "./settings";

describe("toProviderConfig", () => {
	it("backfills knownModels from generated catalogs for anthropic", () => {
		const anthropicModels = getGeneratedModelsForProvider("anthropic");
		const modelId = Object.keys(anthropicModels)[0];
		expect(modelId).toBeTruthy();
		if (!modelId) {
			return;
		}

		const settings: ProviderSettings = {
			provider: "anthropic",
			apiKey: "test-key",
			model: modelId,
		};

		const config = toProviderConfig(settings);

		expect(config.knownModels?.[modelId]).toEqual(anthropicModels[modelId]);
		expect(config.knownModels?.[modelId]?.pricing).toBeDefined();
	});

	it("hydrates cline knownModels using shared catalog key mapping", () => {
		const gatewayModels = Object.assign(
			{},
			...resolveProviderModelCatalogKeys("cline").map((providerId) =>
				getGeneratedModelsForProvider(providerId),
			),
		);
		const modelId = "openai/gpt-5.3-codex";
		expect(gatewayModels[modelId]).toBeDefined();

		const settings: ProviderSettings = {
			provider: "cline",
			apiKey: "test-key",
			model: modelId,
		};

		const config = toProviderConfig(settings);

		expect(config.knownModels?.[modelId]).toEqual(gatewayModels[modelId]);
		expect(config.knownModels?.[modelId]?.pricing).toBeDefined();
	});
});
