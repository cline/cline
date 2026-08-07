import { afterEach, describe, expect, it } from "vitest";
import {
	getModelsForProviderSync,
	MODEL_COLLECTIONS_BY_PROVIDER_ID,
	registerModel,
	registerProvider,
	resetRegistry,
} from "./model-registry";

afterEach(() => {
	resetRegistry();
});

describe("getModelsForProviderSync", () => {
	it("merges separately registered models without widening the provider collection", () => {
		registerModel("openai-compatible", "local-model", {
			id: "local-model",
			contextWindow: 1_048_576,
		});

		expect(
			getModelsForProviderSync("openai-compatible")?.["local-model"],
		).toMatchObject({
			contextWindow: 1_048_576,
		});
		expect(
			MODEL_COLLECTIONS_BY_PROVIDER_ID["openai-compatible"].models[
				"local-model"
			],
		).toBeUndefined();
	});

	it("preserves custom-model precedence over a complete provider collection", () => {
		registerProvider({
			provider: {
				id: "custom-provider",
				name: "Custom Provider",
				baseUrl: "https://example.invalid/v1",
				defaultModelId: "shared-model",
				protocol: "openai-chat",
				client: "openai-compatible",
			},
			models: {
				"shared-model": {
					id: "shared-model",
					contextWindow: 8192,
				},
			},
		});
		registerModel("custom-provider", "shared-model", {
			id: "shared-model",
			contextWindow: 16_384,
		});

		expect(
			getModelsForProviderSync("custom-provider")?.["shared-model"],
		).toMatchObject({
			contextWindow: 16_384,
		});
		expect(
			MODEL_COLLECTIONS_BY_PROVIDER_ID["custom-provider"].models[
				"shared-model"
			],
		).toMatchObject({
			contextWindow: 8192,
		});
	});
});
