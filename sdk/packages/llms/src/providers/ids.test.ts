import { describe, expect, it } from "vitest";
import { createOpenAIProvider } from "./ai-sdk";
import { BUILTIN_PROVIDER_REGISTRATIONS } from "./builtins-runtime";
import { BUILT_IN_PROVIDER_IDS } from "./ids";
import {
	getModelsForProvider,
	getProvider,
	getProviderIds,
} from "./model-registry";

describe("provider-ids", () => {
	it("keeps built-in provider ids aligned with model registry loaders", () => {
		const registryProviderIds = new Set(getProviderIds());
		for (const providerId of BUILT_IN_PROVIDER_IDS) {
			expect(registryProviderIds.has(providerId)).toBe(true);
		}
	});

	it("registers v0 as a built-in provider with generated catalog models", async () => {
		await expect(getProvider("v0")).resolves.toMatchObject({
			id: "v0",
			baseUrl: "https://api.v0.dev/v1",
			defaultModelId: "v0-1.5-md",
			protocol: "openai-responses",
			client: "openai",
		});

		const models = await getModelsForProvider("v0");
		expect(Object.keys(models).sort()).toEqual([
			"v0-1.0-md",
			"v0-1.5-lg",
			"v0-1.5-md",
		]);
	});

	it("routes Responses API built-ins through the OpenAI provider factory", async () => {
		for (const providerId of ["litellm", "v0"]) {
			const provider = await getProvider(providerId);
			expect(provider).toMatchObject({
				id: providerId,
				protocol: "openai-responses",
				client: "openai",
			});

			const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
				(item) => item.manifest.id === providerId,
			);
			await expect(registration?.loadProvider?.()).resolves.toMatchObject({
				createProvider: createOpenAIProvider,
			});
		}
	});
});
