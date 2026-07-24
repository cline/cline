import type { ApiConfiguration } from "@shared/api"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EffectiveProviderConfig, ProviderCatalog, ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { computeConfigFingerprint } from "@/sdk/model-catalog/fingerprint"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { ApiFormat, ModelOverrides } from "@/shared/proto/cline/models"
import type { ProviderCatalogController } from "../providerCatalogShared"

type TestStateManager = {
	setGlobalStateBatch: ReturnType<typeof vi.fn>
	flushPendingState?: ReturnType<typeof vi.fn<() => Promise<void>>>
	getApiConfiguration?: ReturnType<typeof vi.fn<() => ApiConfiguration | undefined>>
}

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
		invalidateProviderListings: vi.fn(),
		resolveModels: vi.fn(),
		peekModels: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}
}

function makeController(
	store: ProviderConfigStore,
	catalog: ProviderCatalog,
	stateManager?: TestStateManager,
	handleApiConfigurationChanged?: ReturnType<typeof vi.fn<(previous: ApiConfiguration, next: ApiConfiguration) => void>>,
): ProviderCatalogController {
	return {
		getProviderConfigStore: () => store,
		getProviderCatalog: () => catalog,
		...(stateManager ? { stateManager } : {}),
		...(handleApiConfigurationChanged ? { handleApiConfigurationChanged } : {}),
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
				usageCostDisplay: "show",
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
				usageCostDisplay: "show",
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
		vi.mocked(store.readSelection).mockImplementation((_providerId, mode) =>
			mode === "act"
				? {
						providerId,
						modelId: "custom-model",
						overrides: {
							capabilities: ["tools", "custom-capability"],
							inputPrice: 1.25,
							supportsVision: false,
							temperature: 0.3,
							apiFormat: ApiFormat.OPENAI_RESPONSES,
						},
						modelInfo: { name: "Custom model", contextWindow: 64_000, supportsPromptCache: false },
					}
				: undefined,
		)
		const controller = makeController(store, makeCatalog())

		const response = await readProviderConfig(controller, { value: "cline" })

		expect(response).toMatchObject({
			providerId: "cline",
			baseUrl: "https://api.example.com/v1",
			apiKeyLength: "SECRET_SENTINEL_API_KEY".length,
			hasAccessToken: true,
			hasRefreshToken: true,
			accountId: "acct-1",
		})
		expect(response.actSelection).toMatchObject({
			providerId: "cline",
			modelId: "custom-model",
			modelInfo: { name: "Custom model", contextWindow: 64_000 },
			overrides: {
				capabilities: ["tools", "custom-capability"],
				inputPrice: 1.25,
				supportsVision: false,
				temperature: 0.3,
				apiFormat: ApiFormat.OPENAI_RESPONSES,
			},
		})
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL_API_KEY")
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL_ACCESS")
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL_REFRESH")
	})

	it("writeProviderConfig writes a patch and returns a redacted response", async () => {
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
		expect(response).toMatchObject({
			apiKeyLength: "SECRET_SENTINEL_OLLAMA".length,
		})
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL_OLLAMA")
	})

	it("writeProviderConfig can explicitly clear headers", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("openai")
		const updatedConfig: EffectiveProviderConfig = {
			providerId,
			headers: {},
		}
		const store = makeStore(updatedConfig)
		const controller = makeController(store, makeCatalog())

		await writeProviderConfig(controller, {
			providerId: "openai",
			patch: { headers: {}, clearHeaders: true },
		})

		expect(store.write).toHaveBeenCalledWith(providerId, { headers: {} })
	})

	it("commitModelSelection validates mode and commits model settings", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const stateManager: TestStateManager = {
			setGlobalStateBatch: vi.fn(),
			flushPendingState: vi.fn(async () => undefined),
		}
		const controller = makeController(store, makeCatalog(), stateManager)

		await commitModelSelection(controller, {
			providerId: "deepseek",
			mode: "act",
			modelId: "deepseek-v4-flash",
			overrides: ModelOverrides.create({
				name: "DeepSeek V4 Flash",
				contextWindow: 456,
				capabilities: ["prompt-cache"],
			}),
		})

		expect(store.commitSelection).toHaveBeenCalledWith(providerId, "act", {
			providerId,
			modelId: "deepseek-v4-flash",
			overrides: expect.objectContaining({
				name: "DeepSeek V4 Flash",
				contextWindow: 456,
				capabilities: ["prompt-cache"],
			}),
		})
		expect(stateManager.setGlobalStateBatch).toHaveBeenCalledWith({
			actModeApiProvider: "deepseek",
			actModeApiModelId: "deepseek-v4-flash",
		})
		expect(stateManager.flushPendingState).toHaveBeenCalledTimes(1)
	})

	// The overrides field is tri-state: absent preserves the model's stored
	// overrides, an explicitly empty message clears them, and a populated
	// message replaces them. The two boundary cases are pinned here because
	// the webview relies on both (see useProviderConfig.test.ts).
	it("commitModelSelection maps an ABSENT overrides field to undefined (preserve stored overrides)", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const controller = makeController(store, makeCatalog())

		await commitModelSelection(controller, {
			providerId: "deepseek",
			mode: "act",
			modelId: "deepseek-v4-flash",
		})

		expect(store.commitSelection).toHaveBeenCalledWith(providerId, "act", {
			providerId,
			modelId: "deepseek-v4-flash",
			overrides: undefined,
		})
	})

	it("commitModelSelection maps an EMPTY overrides message to an empty object (clear stored overrides)", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const controller = makeController(store, makeCatalog())

		await commitModelSelection(controller, {
			providerId: "deepseek",
			mode: "act",
			modelId: "deepseek-v4-flash",
			overrides: ModelOverrides.create({}),
		})

		expect(store.commitSelection).toHaveBeenCalledWith(providerId, "act", {
			providerId,
			modelId: "deepseek-v4-flash",
			overrides: {},
		})
	})

	it("commitModelSelection reports provider changes when config is initialized", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const stateManager: TestStateManager = {
			setGlobalStateBatch: vi.fn(),
			flushPendingState: vi.fn(async () => undefined),
			getApiConfiguration: vi
				.fn<() => ApiConfiguration | undefined>()
				.mockReturnValueOnce(undefined)
				.mockReturnValueOnce({ actModeApiProvider: "deepseek" }),
		}
		const handleApiConfigurationChanged = vi.fn<(previous: ApiConfiguration, next: ApiConfiguration) => void>()
		const controller = makeController(store, makeCatalog(), stateManager, handleApiConfigurationChanged)

		await commitModelSelection(controller, {
			providerId: "deepseek",
			mode: "act",
			modelId: "deepseek-v4-flash",
			overrides: ModelOverrides.create({ name: "DeepSeek V4 Flash" }),
		})

		expect(handleApiConfigurationChanged).toHaveBeenCalledWith({}, { actModeApiProvider: "deepseek" })
		expect(stateManager.flushPendingState).toHaveBeenCalledTimes(1)
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
				overrides: ModelOverrides.create({ capabilities: ["prompt-cache"] }),
			}),
		).rejects.toThrow('mode must be "plan" or "act"')
		expect(store.commitSelection).not.toHaveBeenCalled()
	})
})
