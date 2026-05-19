import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider, createOpenAIProvider } from "./ai-sdk";
import { BUILTIN_PROVIDER_REGISTRATIONS } from "./builtins-runtime";
import { createGateway } from "./gateway";
import { BUILT_IN_PROVIDER_IDS, normalizeProviderId } from "./ids";
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

	it("uses openai-compatible as the OpenAI Compatible built-in provider", async () => {
		expect(normalizeProviderId("openai")).toBe("openai-compatible");
		expect(BUILT_IN_PROVIDER_IDS).not.toContain("openai");
		expect(BUILT_IN_PROVIDER_IDS).toContain("openai-compatible");

		await expect(getProvider("openai-compatible")).resolves.toMatchObject({
			id: "openai-compatible",
			name: "OpenAI Compatible",
			baseUrl: "https://api.openai.com/v1",
			defaultModelId: "gpt-4o",
			client: "openai-compatible",
		});
		await expect(
			getModelsForProvider("openai-compatible"),
		).resolves.toMatchObject({
			"gpt-4o": {
				id: "gpt-4o",
				contextWindow: 128_000,
				maxInputTokens: 128_000,
			},
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "openai-compatible",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					baseUrl: "https://gateway.example.invalid/v1",
					models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
				},
			],
		});
		expect(gateway.listModels("openai-compatible")).toContainEqual(
			expect.objectContaining({
				id: "gpt-oss-120b",
				providerId: "openai-compatible",
			}),
		);
	});

	it("registers Poolside as a deployment-configured OpenAI-compatible provider", async () => {
		expect(BUILT_IN_PROVIDER_IDS).toContain("poolside");

		await expect(getProvider("poolside")).resolves.toMatchObject({
			id: "poolside",
			name: "Poolside",
			defaultModelId: "default",
			client: "openai-compatible",
			protocol: "openai-chat",
			env: ["POOLSIDE_API_KEY"],
			baseUrlPlaceholder: "https://<api-domain>/v1",
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "poolside",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
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
