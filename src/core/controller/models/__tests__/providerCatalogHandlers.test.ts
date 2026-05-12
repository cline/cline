import { afterEach, describe, expect, it, vi } from "vitest"
import type { EffectiveProviderConfig, ProviderCatalog, ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { computeConfigFingerprint } from "@/sdk/model-catalog/fingerprint"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { ApiFormat, OpenRouterModelInfo } from "@/shared/proto/cline/models"
import type { ProviderCatalogController } from "../providerCatalogShared"

function makeStore(config: EffectiveProviderConfig): ProviderConfigStore {
	return {
		read: vi.fn(() => config),
		readSelection: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		write: vi.fn(() => config),
		commitSelection: vi.fn(),
	}
}

function makeCatalog(): ProviderCatalog {
	return {
		listProviders: vi.fn(async () => []),
		resolveModels: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}
}

function makeController(store: ProviderConfigStore, catalog: ProviderCatalog): ProviderCatalogController {
	return {
		getProviderConfigStore: () => store,
		getProviderCatalog: () => catalog,
	}
}

describe("provider model catalog handlers", () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	it("listProviders returns provider listings from the catalog singleton", async () => {
		const { listProviders } = await import("../listProviders")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const catalog = makeCatalog()
		vi.mocked(catalog.listProviders).mockResolvedValue([
			{
				id: providerId,
				name: "DeepSeek",
				defaultModelId: "deepseek-v4-flash",
				protocol: "openai-chat",
				authDescription: "DeepSeek models",
				allowsCustomModelIds: false,
			},
		])
		const controller = makeController(store, catalog)

		const response = await listProviders(controller, {})

		expect(response.providers).toEqual([
			{
				id: "deepseek",
				name: "DeepSeek",
				defaultModelId: "deepseek-v4-flash",
				family: undefined,
				protocol: "openai-chat",
				authDescription: "DeepSeek models",
				baseUrlDescription: undefined,
				allowsCustomModelIds: false,
			},
		])
		expect(catalog.listProviders).toHaveBeenCalledTimes(1)
	})

	it("resolveProviderModels returns full protobuf model metadata and request id", async () => {
		const { resolveProviderModels } = await import("../resolveProviderModels")
		const providerId = parseProviderId("deepseek")
		const fingerprint = computeConfigFingerprint(providerId, { providerId, apiKey: "secret" })
		const store = makeStore({ providerId, apiKey: "secret" })
		const catalog = makeCatalog()
		vi.mocked(catalog.resolveModels).mockResolvedValue({
			ok: true,
			providerId,
			configFingerprint: fingerprint,
			models: new Map([
				[
					"deepseek-v4-flash",
					{
						name: "DeepSeek V4 Flash",
						maxTokens: 123,
						contextWindow: 456,
						supportsImages: true,
						supportsPromptCache: true,
						supportsReasoning: true,
						inputPrice: 1,
						outputPrice: 2,
						cacheWritesPrice: 3,
						cacheReadsPrice: 4,
						description: "rich metadata",
						temperature: 0.2,
						apiFormat: ApiFormat.OPENAI_CHAT,
					},
				],
			]),
			defaultModelId: "deepseek-v4-flash",
			source: "sdk-dynamic",
			fetchedAt: 99,
		})
		const controller = makeController(store, catalog)

		const response = await resolveProviderModels(controller, {
			providerId: "deepseek",
			forceRefresh: true,
			requestId: "req-1",
		})

		expect(response.requestId).toBe("req-1")
		expect(response.configFingerprint).toBe(fingerprint)
		expect(response.models["deepseek-v4-flash"]).toMatchObject({
			name: "DeepSeek V4 Flash",
			maxTokens: 123,
			contextWindow: 456,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			temperature: 0.2,
			apiFormat: ApiFormat.OPENAI_CHAT,
		})
		expect(catalog.resolveModels).toHaveBeenCalledWith(providerId, { forceRefresh: true })
	})

	it("readProviderConfig redacts secrets", async () => {
		const { readProviderConfig } = await import("../readProviderConfig")
		const providerId = parseProviderId("cline")
		const store = makeStore({
			providerId,
			apiKey: "SECRET_SENTINEL_API_KEY",
			baseUrl: "https://api.example.com/v1",
			auth: { accessToken: "SECRET_SENTINEL_ACCESS", refreshToken: "SECRET_SENTINEL_REFRESH", accountId: "acct-1" },
		})
		const controller = makeController(store, makeCatalog())

		const response = await readProviderConfig(controller, { value: "cline" })

		expect(response).toMatchObject({
			providerId: "cline",
			baseUrl: "https://api.example.com/v1",
			hasApiKey: true,
			hasAccessToken: true,
			hasRefreshToken: true,
			accountId: "acct-1",
		})
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL")
	})

	it("writeProviderConfig writes a patch and returns redacted updated config", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("ollama")
		const updatedConfig: EffectiveProviderConfig = {
			providerId,
			apiKey: "SECRET_SENTINEL_OLLAMA",
			baseUrl: "http://localhost:11434/v1",
		}
		const store = makeStore(updatedConfig)
		const controller = makeController(store, makeCatalog())

		const response = await writeProviderConfig(controller, {
			providerId: "ollama",
			patch: { apiKey: "SECRET_SENTINEL_OLLAMA", baseUrl: "http://localhost:11434/v1", headers: {} },
		})

		expect(store.write).toHaveBeenCalledWith(providerId, {
			apiKey: "SECRET_SENTINEL_OLLAMA",
			baseUrl: "http://localhost:11434/v1",
		})
		expect(response.hasApiKey).toBe(true)
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL")
	})

	it("commitModelSelection validates mode and commits the full selection envelope", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const controller = makeController(store, makeCatalog())

		await commitModelSelection(controller, {
			providerId: "deepseek",
			mode: "act",
			modelId: "deepseek-v4-flash",
			modelInfo: OpenRouterModelInfo.create({
				name: "DeepSeek V4 Flash",
				contextWindow: 456,
				supportsPromptCache: true,
				apiFormat: ApiFormat.OPENAI_CHAT,
			}),
		})

		expect(store.commitSelection).toHaveBeenCalledWith(providerId, "act", {
			providerId,
			modelId: "deepseek-v4-flash",
			modelInfo: expect.objectContaining({
				name: "DeepSeek V4 Flash",
				contextWindow: 456,
				supportsPromptCache: true,
				apiFormat: ApiFormat.OPENAI_CHAT,
			}),
		})
	})

	it("commitModelSelection rejects invalid mode", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const controller = makeController(store, makeCatalog())

		await expect(
			commitModelSelection(controller, {
				providerId: "deepseek",
				mode: "invalid",
				modelId: "deepseek-v4-flash",
				modelInfo: OpenRouterModelInfo.create({ supportsPromptCache: true }),
			}),
		).rejects.toThrow('mode must be "plan" or "act"')
		expect(store.commitSelection).not.toHaveBeenCalled()
	})
})
