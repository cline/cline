import { describe, expect, it } from "vitest";
import {
	createOpenAICompatibleProvider,
	createOpenAIProvider,
	createSapAiCoreProvider,
} from "./ai-sdk";
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
			client: "openai-compatible",
		});

		const models = await getModelsForProvider("v0");
		expect(Object.keys(models).sort()).toEqual([
			"v0-1.0-md",
			"v0-1.5-lg",
			"v0-1.5-md",
		]);

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "v0",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
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

	it("registers ClinePass as a distinct Cline-compatible built-in provider", async () => {
		expect(BUILT_IN_PROVIDER_IDS).toContain("cline-pass");
		const models = await getModelsForProvider("cline-pass");
		const provider = await getProvider("cline-pass");

		expect(provider).toMatchObject({
			id: "cline-pass",
			name: "ClinePass",
			client: "openai-compatible",
		});
		expect(models).toHaveProperty(provider?.defaultModelId ?? "");

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "cline-pass",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("registers Poolside as an OpenAI-compatible built-in provider", async () => {
		expect(BUILT_IN_PROVIDER_IDS).toContain("poolside");

		await expect(getProvider("poolside")).resolves.toMatchObject({
			id: "poolside",
			name: "Poolside",
			baseUrl: "https://inference.poolside.ai/v1",
			defaultModelId: "poolside/laguna-m.1:free",
			client: "openai-compatible",
		});
		const models = await getModelsForProvider("poolside");
		expect(Object.hasOwn(models, "poolside/laguna-m.1:free")).toBe(true);

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "poolside",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("routes Responses API built-ins through the OpenAI provider factory", async () => {
		const provider = await getProvider("litellm");
		expect(provider).toMatchObject({
			id: "litellm",
			protocol: "openai-responses",
			client: "openai",
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "litellm",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAIProvider,
		});
	});

	it("registers Xiaomi as an OpenAI-compatible built-in provider", async () => {
		await expect(getProvider("xiaomi")).resolves.toMatchObject({
			id: "xiaomi",
			baseUrl: "https://api.xiaomimimo.com/v1",
			defaultModelId: "mimo-v2-omni",
			client: "openai-compatible",
		});

		await expect(getModelsForProvider("xiaomi")).resolves.toHaveProperty(
			"mimo-v2-omni",
		);

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "xiaomi",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("routes SAP AI Core through the SAP AI SDK provider factory", async () => {
		await expect(getProvider("sapaicore")).resolves.toMatchObject({
			id: "sapaicore",
			name: "SAP AI Core",
			client: "ai-sdk-community",
			defaultModelId: "anthropic--claude-3.5-sonnet",
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "sapaicore",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createSapAiCoreProvider,
		});
	});
});
