import { syncStoredProviderRegistration } from "@cline/core"
import { type ApiConfiguration, type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { ApiFormat } from "@shared/proto/cline/models"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderConfigChange } from "./contracts"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => {
	type MockApiConfiguration = ApiConfiguration & { planActSeparateModelsSetting?: boolean }
	let apiConfiguration: MockApiConfiguration = {}
	let providerSettingsById: Record<string, Record<string, unknown>> = {}
	let generatedModelsByProvider: Record<string, Record<string, ModelInfo>> = {}
	let modelsFile: { version: 1; providers: Record<string, { models?: Record<string, Record<string, unknown>> }> } = {
		version: 1,
		providers: {},
	}
	const saveProviderSettings = vi.fn((settings: Record<string, unknown>, _options?: { setLastUsed?: boolean }) => {
		const provider = settings.provider
		if (typeof provider !== "string") {
			throw new Error("provider is required")
		}
		providerSettingsById[provider] = { ...settings }
		return { version: 1, providers: {} }
	})

	return {
		reset(): void {
			apiConfiguration = {}
			providerSettingsById = {}
			generatedModelsByProvider = {}
			modelsFile = { version: 1, providers: {} }
			saveProviderSettings.mockClear()
		},
		setApiConfiguration(value: MockApiConfiguration): void {
			apiConfiguration = { ...value }
		},
		setProviderSettings(value: Record<string, Record<string, unknown>>): void {
			providerSettingsById = { ...value }
		},
		setGeneratedModels(providerId: string, models: Record<string, ModelInfo>): void {
			generatedModelsByProvider = { ...generatedModelsByProvider, [providerId]: models }
		},
		getGeneratedModels(providerId: string): Record<string, ModelInfo> {
			return generatedModelsByProvider[providerId] ?? {}
		},
		getSavedProviderSettings(providerId: string): Record<string, unknown> | undefined {
			return providerSettingsById[providerId]
		},
		getApiConfiguration(): MockApiConfiguration {
			return { ...apiConfiguration }
		},
		getSaveProviderSettingsMock(): typeof saveProviderSettings {
			return saveProviderSettings
		},
		getModelsFile() {
			return modelsFile
		},
		setModelsFile(value: typeof modelsFile): void {
			modelsFile = value
		},
		getStateManager() {
			return {
				getApiConfiguration: () => ({ ...apiConfiguration }),
				getGlobalSettingsKey: (key: keyof MockApiConfiguration) => apiConfiguration[key],
				setSecret: (key: keyof MockApiConfiguration, value: unknown) => {
					apiConfiguration = { ...apiConfiguration, [key]: value }
				},
				setGlobalState: (key: keyof MockApiConfiguration, value: unknown) => {
					apiConfiguration = { ...apiConfiguration, [key]: value }
				},
				setGlobalStateBatch: (updates: MockApiConfiguration) => {
					apiConfiguration = { ...apiConfiguration, ...updates }
				},
			}
		},
		getProviderSettingsManager() {
			return {
				getProviderSettings: (providerId: string) => providerSettingsById[providerId],
				saveProviderSettings,
			}
		},
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: mocks.getStateManager },
}))

vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@cline/core", () => ({
	syncStoredProviderRegistration: vi.fn(),
	readModelsFileSync: vi.fn(() => mocks.getModelsFile()),
	resolveModelsRegistryPath: vi.fn(() => "/tmp/models.json"),
	writeModelsFileSync: vi.fn((_filePath: string, state: ReturnType<typeof mocks.getModelsFile>) => mocks.setModelsFile(state)),
}))

vi.mock("@cline/llms", () => ({
	getGeneratedModelsForProvider: vi.fn((providerId: string) => mocks.getGeneratedModels(providerId)),
	MODEL_COLLECTIONS_BY_PROVIDER_ID: {},
}))

const modelInfoA: ModelInfo = {
	name: "Model A",
	contextWindow: 128_000,
	maxTokens: 8_192,
	supportsPromptCache: true,
	apiFormat: ApiFormat.OPENAI_RESPONSES,
}

const modelInfoB: ModelInfo = {
	name: "Model B",
	contextWindow: 64_000,
	maxTokens: 4_096,
	supportsPromptCache: false,
}

function selectionFromModelInfo(providerId: ReturnType<typeof parseProviderId>, modelId: string, modelInfo: ModelInfo) {
	const capabilities: string[] = []
	if (modelInfo.supportsPromptCache) capabilities.push("prompt-cache")
	if (modelInfo.supportsImages) capabilities.push("images")
	if (modelInfo.supportsReasoning) capabilities.push("reasoning")
	return {
		providerId,
		modelId,
		overrides: {
			name: modelInfo.name,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			...(modelInfo.apiFormat !== undefined ? { apiFormat: modelInfo.apiFormat } : {}),
			...(capabilities.length > 0 ? { capabilities } : {}),
		},
	}
}

function expectResolvedSelection(
	actual: unknown,
	selection: ReturnType<typeof selectionFromModelInfo>,
	modelInfo: ModelInfo,
): void {
	expect(actual).toMatchObject({
		providerId: selection.providerId,
		modelId: selection.modelId,
		overrides: selection.overrides,
		modelInfo,
	})
}

describe("createProviderConfigStore", () => {
	beforeEach(() => {
		mocks.reset()
		vi.clearAllMocks()
		vi.resetModules()
	})

	it("round-trips write then read with fresh structurally equal objects", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("deepseek")

		const written = store.write(providerId, { apiKey: "deepseek-key" })
		const firstRead = store.read(providerId)
		const secondRead = store.read(providerId)

		expect(written).toEqual({ providerId, apiKey: "deepseek-key" })
		expect(firstRead).toEqual(written)
		expect(secondRead).toEqual(firstRead)
		expect(secondRead).not.toBe(firstRead)
	})

	it("clears string fields from providers.json when they are written as empty strings", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setProviderSettings({ gemini: { provider: "gemini", apiKey: "existing-key", baseUrl: "https://custom.example" } })
		mocks.setApiConfiguration({ geminiApiKey: "existing-key", geminiBaseUrl: "https://custom.example" })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("gemini")

		store.write(providerId, { baseUrl: "" })

		expect(mocks.getSavedProviderSettings("gemini")).toEqual({ provider: "gemini", apiKey: "existing-key" })
		expect(store.read(providerId).baseUrl).toBeUndefined()
	})

	it("round-trips commitSelection then readSelection for provider-specific model info", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const selection = selectionFromModelInfo(providerId, "anthropic/claude-sonnet-4", modelInfoA)

		store.commitSelection(providerId, "act", selection)

		expectResolvedSelection(store.readSelection(providerId, "act"), selection, modelInfoA)
		expect(mocks.getModelsFile().providers.openrouter?.models?.["anthropic/claude-sonnet-4"]).toMatchObject({
			name: "Model A",
			contextWindow: 128_000,
			maxTokens: 8_192,
			apiFormat: "openai-responses",
			capabilities: ["prompt-cache"],
		})
	})

	it("round-trips generic provider selections using the in-process modelInfo envelope", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("deepseek")
		const selection = selectionFromModelInfo(providerId, "deepseek-v4-pro", modelInfoA)

		store.commitSelection(providerId, "act", selection)

		expectResolvedSelection(store.readSelection(providerId, "act"), selection, modelInfoA)
	})

	it("hydrates a generic provider selection from providers.json after reload", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setProviderSettings({ zai: { provider: "zai", model: "manual-zai-model" } })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("zai")

		expect(store.readSelection(providerId, "act")).toEqual({
			providerId,
			modelId: "manual-zai-model",
			modelInfoSource: "fallback",
			baseModelInfo: expect.objectContaining({ name: "manual-zai-model" }),
			modelInfo: expect.objectContaining({
				name: "manual-zai-model",
				supportsPromptCache: false,
			}),
		})
	})

	it("does not combine a generic provider's remembered model info with another provider's active model id", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const geminiProviderId = parseProviderId("gemini")
		const deepSeekProviderId = parseProviderId("deepseek")
		const geminiSelection = selectionFromModelInfo(geminiProviderId, "gemini-3.1-pro-preview", modelInfoA)
		const deepSeekSelection = selectionFromModelInfo(deepSeekProviderId, "deepseek-v4-pro", modelInfoB)

		store.commitSelection(geminiProviderId, "act", geminiSelection)
		store.commitSelection(deepSeekProviderId, "act", deepSeekSelection)

		expectResolvedSelection(store.readSelection(geminiProviderId, "act"), geminiSelection, modelInfoA)
		expectResolvedSelection(store.readSelection(deepSeekProviderId, "act"), deepSeekSelection, modelInfoB)
	})

	it("handles normalized nousResearch provider casing for writes and selections", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("nousResearch")
		const selection = selectionFromModelInfo(providerId, "nousresearch/hermes-4-70b", modelInfoA)

		const written = store.write(providerId, { apiKey: "nous-key" })
		store.commitSelection(providerId, "act", selection)

		expect(written).toEqual({ providerId, apiKey: "nous-key" })
		expectResolvedSelection(store.readSelection(providerId, "act"), selection, modelInfoA)
		expect(mocks.getSavedProviderSettings("nousResearch")).toMatchObject({
			provider: "nousResearch",
			apiKey: "nous-key",
			model: "nousresearch/hermes-4-70b",
		})
	})

	it("reads and writes the Novita API key through StateManager", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("novita-ai")

		const written = store.write(providerId, { apiKey: "novita-key" })

		expect(written).toEqual({ providerId, apiKey: "novita-key" })
		expect(mocks.getApiConfiguration().novitaApiKey).toBe("novita-key")
		expect(store.read(providerId)).toEqual(written)
	})

	it("reads migrated OpenAI Compatible settings from the SDK provider id", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setProviderSettings({
			"openai-compatible": {
				provider: "openai-compatible",
				apiKey: "migrated-openai-compatible-key",
				baseUrl: "https://gateway.example.invalid/v1",
				headers: { "X-Test": "legacy-header" },
			},
		})
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		expect(store.read(providerId)).toEqual({
			providerId,
			apiKey: "migrated-openai-compatible-key",
			baseUrl: "https://gateway.example.invalid/v1",
			headers: { "X-Test": "legacy-header" },
		})
	})

	it("writes OpenAI Compatible settings under the SDK provider id", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.write(providerId, {
			apiKey: "openai-compatible-key",
			baseUrl: "https://gateway.example.invalid/v1",
		})

		expect(mocks.getSavedProviderSettings("openai")).toBeUndefined()
		expect(mocks.getSavedProviderSettings("openai-compatible")).toMatchObject({
			provider: "openai-compatible",
			apiKey: "openai-compatible-key",
			baseUrl: "https://gateway.example.invalid/v1",
		})
	})

	it("lazily migrates meaningful legacy custom-model metadata once", async () => {
		const legacyModelInfo = {
			name: "Legacy Custom",
			maxTokens: 4_096,
			contextWindow: 64_000,
			supportsImages: false,
			supportsPromptCache: true,
			supportsReasoning: true,
			inputPrice: 1,
			outputPrice: 2,
			cacheReadsPrice: 0.25,
			cacheWritesPrice: 0.5,
			temperature: 0.3,
			apiFormat: ApiFormat.OPENAI_RESPONSES,
			isR1FormatRequired: true,
		}
		mocks.setApiConfiguration({
			actModeOpenAiModelId: "legacy-custom",
			actModeOpenAiModelInfo: legacyModelInfo,
		})
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		const first = store.readSelection(providerId, "act")
		const second = store.readSelection(providerId, "act")

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["legacy-custom"]).toEqual({
			name: "Legacy Custom",
			maxTokens: 4_096,
			contextWindow: 64_000,
			capabilities: ["prompt-cache"],
			supportsVision: false,
			supportsReasoning: true,
			inputPrice: 1,
			outputPrice: 2,
			cacheReadsPrice: 0.25,
			cacheWritesPrice: 0.5,
			temperature: 0.3,
			apiFormat: "openai-responses",
			isR1FormatRequired: true,
		})
		expect(first?.overrides).toEqual(second?.overrides)
		expect(first?.modelInfo).toMatchObject({
			name: "Legacy Custom",
			maxTokens: 4_096,
			contextWindow: 64_000,
			supportsImages: false,
			supportsPromptCache: true,
			supportsReasoning: true,
			inputPrice: 1,
			outputPrice: 2,
			cacheReadsPrice: 0.25,
			cacheWritesPrice: 0.5,
			temperature: 0.3,
			apiFormat: ApiFormat.R1_CHAT,
		})
		expect(syncStoredProviderRegistration).toHaveBeenCalledTimes(1)
	})

	it("does not create migration noise for legacy safe defaults", async () => {
		mocks.setApiConfiguration({
			actModeOpenAiModelId: "default-custom",
			actModeOpenAiModelInfo: { ...openAiModelInfoSafeDefaults, name: "default-custom" },
		})
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		const first = store.readSelection(providerId, "act")
		const second = store.readSelection(providerId, "act")

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["default-custom"]).toBeUndefined()
		expect(first?.overrides).toBeUndefined()
		expect(second?.overrides).toBeUndefined()
		expect(first?.modelInfo).toMatchObject({ contextWindow: 128_000, supportsImages: true, temperature: 0 })
		expect(first?.modelInfo.maxTokens).toBeUndefined()
		expect(syncStoredProviderRegistration).not.toHaveBeenCalled()
	})

	it("never overwrites an existing models.json entry during migration", async () => {
		mocks.setModelsFile({
			version: 1,
			providers: {
				"openai-compatible": { models: { "existing-custom": { temperature: 0.7 } } },
			},
		})
		mocks.setApiConfiguration({
			actModeOpenAiModelId: "existing-custom",
			actModeOpenAiModelInfo: { ...openAiModelInfoSafeDefaults, temperature: 0.2 },
		})
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		const selection = store.readSelection(providerId, "act")

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["existing-custom"]).toEqual({
			temperature: 0.7,
		})
		expect(selection?.overrides).toEqual({ temperature: 0.7 })
		expect(selection?.modelInfo.temperature).toBe(0.7)
		expect(syncStoredProviderRegistration).not.toHaveBeenCalled()
	})

	it("does not migrate stale legacy snapshots for catalog-known models", async () => {
		mocks.setGeneratedModels("openai-compatible", {
			"known-model": {
				name: "Current Catalog Model",
				contextWindow: 256_000,
				supportsPromptCache: false,
				temperature: 0.1,
			},
		})
		mocks.setApiConfiguration({
			actModeOpenAiModelId: "known-model",
			actModeOpenAiModelInfo: {
				name: "Stale Catalog Model",
				contextWindow: 32_000,
				supportsPromptCache: false,
				temperature: 0.9,
			},
		})
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		const selection = store.readSelection(providerId, "act")

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["known-model"]).toBeUndefined()
		expect(selection?.overrides).toBeUndefined()
		expect(selection?.modelInfo).toMatchObject({
			name: "Current Catalog Model",
			contextWindow: 256_000,
			temperature: 0.1,
		})
		expect(syncStoredProviderRegistration).not.toHaveBeenCalled()
	})

	it("migrates separate Plan and Act legacy custom models independently", async () => {
		mocks.setApiConfiguration({
			planActSeparateModelsSetting: true,
			planModeOpenAiModelId: "legacy-plan",
			planModeOpenAiModelInfo: {
				...openAiModelInfoSafeDefaults,
				contextWindow: 64_000,
				apiFormat: ApiFormat.OPENAI_RESPONSES,
			},
			actModeOpenAiModelId: "legacy-act",
			actModeOpenAiModelInfo: {
				...openAiModelInfoSafeDefaults,
				maxTokens: 2_048,
				isR1FormatRequired: true,
			},
		})
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		const plan = store.readSelection(providerId, "plan")
		const act = store.readSelection(providerId, "act")
		store.readSelection(providerId, "plan")
		store.readSelection(providerId, "act")

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models).toMatchObject({
			"legacy-plan": { contextWindow: 64_000, apiFormat: "openai-responses" },
			"legacy-act": { maxTokens: 2_048, isR1FormatRequired: true },
		})
		expect(plan?.modelInfo).toMatchObject({ contextWindow: 64_000, apiFormat: ApiFormat.OPENAI_RESPONSES })
		expect(act?.modelInfo).toMatchObject({ maxTokens: 2_048, apiFormat: ApiFormat.R1_CHAT })
		expect(syncStoredProviderRegistration).toHaveBeenCalledTimes(2)
	})

	it("preserves migrated OpenAI Compatible settings when committing model selections", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setProviderSettings({
			"openai-compatible": {
				provider: "openai-compatible",
				apiKey: "migrated-openai-compatible-key",
			},
		})
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")
		const selection = selectionFromModelInfo(providerId, "gpt-oss-120b", modelInfoA)

		store.commitSelection(providerId, "act", selection)

		expect(mocks.getSavedProviderSettings("openai-compatible")).toMatchObject({
			provider: "openai-compatible",
			apiKey: "migrated-openai-compatible-key",
			model: "gpt-oss-120b",
		})
	})

	it("preserves per-model OpenAI Compatible overrides when switching models without new overrides", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")
		const modelASelection = selectionFromModelInfo(providerId, "model-a", modelInfoA)

		store.commitSelection(providerId, "act", modelASelection)
		store.commitSelection(providerId, "act", { providerId, modelId: "model-b" })
		store.commitSelection(providerId, "act", { providerId, modelId: "model-a" })

		expectResolvedSelection(store.readSelection(providerId, "act"), modelASelection, modelInfoA)
		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["model-a"]).toMatchObject({
			name: "Model A",
			maxTokens: 8_192,
			contextWindow: 128_000,
		})
	})

	it("deletes a model entry when an explicit replacement override set is empty", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: {
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				capabilities: ["tools", "streaming"],
				temperature: 0.2,
			},
		})
		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["custom-model"]).toMatchObject({
			apiFormat: "openai-responses",
			capabilities: ["tools", "streaming"],
			temperature: 0.2,
		})

		store.commitSelection(providerId, "act", { providerId, modelId: "custom-model", overrides: {} })

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["custom-model"]).toBeUndefined()
		expect(store.readSelection(providerId, "act")?.overrides).toBeUndefined()
	})

	it("replaces an existing model override set instead of merging stale fields", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: { apiFormat: ApiFormat.OPENAI_RESPONSES, inputPrice: 1, temperature: 0.2 },
		})
		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: { temperature: 0.4 },
		})

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["custom-model"]).toEqual({ temperature: 0.4 })
		expect(store.readSelection(providerId, "act")?.overrides).toEqual({ temperature: 0.4 })
	})

	it.each([
		[ApiFormat.OPENAI_CHAT, "default"],
		[ApiFormat.R1_CHAT, "r1"],
		[ApiFormat.OPENAI_RESPONSES, "openai-responses"],
	] as const)("round-trips supported apiFormat %s through models.json", async (apiFormat, storedApiFormat) => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: { apiFormat },
		})

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["custom-model"]).toEqual({
			apiFormat: storedApiFormat,
		})
		expect(store.readSelection(providerId, "act")?.overrides).toEqual({ apiFormat })
	})

	it("normalizes invalid override values before storage and resolved legacy state", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: {
				name: "Custom model",
				maxTokens: -1,
				contextWindow: Number.POSITIVE_INFINITY,
				maxInputTokens: 0,
				capabilities: ["tools", "tools", "vision", "unknown"],
				supportsVision: false,
				supportsReasoning: false,
				inputPrice: Number.NaN,
				outputPrice: 2,
				cacheReadsPrice: 0,
				cacheWritesPrice: -1,
				temperature: -1,
				apiFormat: 999 as ApiFormat,
			},
		})

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["custom-model"]).toEqual({
			name: "Custom model",
			capabilities: ["tools"],
			supportsVision: false,
			supportsReasoning: false,
			outputPrice: 2,
			cacheReadsPrice: 0,
		})
		const selection = store.readSelection(providerId, "act")
		expect(selection?.overrides).toEqual({
			name: "Custom model",
			capabilities: ["tools"],
			supportsVision: false,
			supportsReasoning: false,
			outputPrice: 2,
			cacheReadsPrice: 0,
		})
		expect(selection?.modelInfo.maxTokens).toBeUndefined()
		expect(selection?.modelInfo.temperature).toBe(0)
		expect(mocks.getApiConfiguration().actModeOpenAiModelInfo).not.toHaveProperty("maxTokens")
		expect(mocks.getApiConfiguration().actModeOpenAiModelInfo).not.toHaveProperty("temperature", -1)
		expect(syncStoredProviderRegistration).toHaveBeenCalledTimes(1)
	})

	it("deletes a stored entry when normalization removes every replacement field", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: { temperature: 0.2 },
		})
		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: {
				maxTokens: -1,
				contextWindow: 0,
				capabilities: ["vision", "unknown"],
				inputPrice: Number.NaN,
				temperature: -1,
				apiFormat: 999 as ApiFormat,
			},
		})

		expect(mocks.getModelsFile().providers["openai-compatible"]?.models?.["custom-model"]).toBeUndefined()
		expect(store.readSelection(providerId, "act")?.overrides).toBeUndefined()
		expect(syncStoredProviderRegistration).toHaveBeenCalledTimes(2)
	})

	it("normalizes invalid values already present in models.json on read", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setProviderSettings({
			"openai-compatible": { provider: "openai-compatible", model: "custom-model" },
		})
		mocks.setModelsFile({
			version: 1,
			providers: {
				"openai-compatible": {
					models: {
						"custom-model": {
							maxTokens: -1,
							contextWindow: 64_000,
							inputPrice: -2,
							temperature: -1,
							capabilities: ["tools"],
						},
					},
				},
			},
		})
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		const selection = store.readSelection(providerId, "act")

		expect(selection?.overrides).toEqual({ contextWindow: 64_000, capabilities: ["tools"] })
		expect(selection?.modelInfo.maxTokens).toBeUndefined()
		expect(selection?.modelInfo.temperature).toBe(0)
		expect(syncStoredProviderRegistration).not.toHaveBeenCalled()
	})

	it("lets explicit capability booleans win and applies the R1 alias deterministically", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: {
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				capabilities: ["images", "prompt-cache", "reasoning"],
				supportsVision: false,
				supportsReasoning: false,
				isR1FormatRequired: false,
			},
		})
		let selection = store.readSelection(providerId, "act")
		expect(selection?.modelInfo).toMatchObject({
			supportsImages: false,
			supportsPromptCache: true,
			supportsReasoning: false,
			apiFormat: ApiFormat.OPENAI_RESPONSES,
		})

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "custom-model",
			overrides: {
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				capabilities: ["prompt-cache"],
				supportsVision: true,
				isR1FormatRequired: true,
			},
		})
		selection = store.readSelection(providerId, "act")
		expect(selection?.modelInfo).toMatchObject({
			supportsImages: true,
			supportsPromptCache: true,
			apiFormat: ApiFormat.R1_CHAT,
		})
	})

	it("keeps OpenAI Compatible Plan and Act selections independent when separate models are enabled", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({ planActSeparateModelsSetting: true })
		mocks.setProviderSettings({
			"openai-compatible": {
				provider: "openai-compatible",
				apiKey: "migrated-openai-compatible-key",
			},
		})
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")
		const planSelection = selectionFromModelInfo(providerId, "plan-openai-model", modelInfoA)
		const actSelection = selectionFromModelInfo(providerId, "act-openai-model", modelInfoB)

		store.commitSelection(providerId, "plan", planSelection)
		store.commitSelection(providerId, "act", actSelection)

		expectResolvedSelection(store.readSelection(providerId, "plan"), planSelection, modelInfoA)
		expectResolvedSelection(store.readSelection(providerId, "act"), actSelection, modelInfoB)
		expect(mocks.getApiConfiguration()).toMatchObject({
			planModeOpenAiModelId: "plan-openai-model",
			planModeOpenAiModelInfo: modelInfoA,
			actModeOpenAiModelId: "act-openai-model",
			actModeOpenAiModelInfo: modelInfoB,
		})
		expect(mocks.getSavedProviderSettings("openai")).toBeUndefined()
		expect(mocks.getSavedProviderSettings("openai-compatible")).toMatchObject({
			provider: "openai-compatible",
			apiKey: "migrated-openai-compatible-key",
			model: "act-openai-model",
		})
	})

	it("mirrors OpenAI Compatible selections to both modes when separate models are disabled", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({ planActSeparateModelsSetting: false })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")
		const selection = selectionFromModelInfo(providerId, "shared-openai-model", modelInfoA)

		store.commitSelection(providerId, "act", selection)

		expectResolvedSelection(store.readSelection(providerId, "plan"), selection, modelInfoA)
		expectResolvedSelection(store.readSelection(providerId, "act"), selection, modelInfoA)
		expect(mocks.getApiConfiguration()).toMatchObject({
			planModeOpenAiModelId: "shared-openai-model",
			planModeOpenAiModelInfo: modelInfoA,
			actModeOpenAiModelId: "shared-openai-model",
			actModeOpenAiModelInfo: modelInfoA,
		})
		expect(mocks.getSavedProviderSettings("openai-compatible")).toMatchObject({
			provider: "openai-compatible",
			model: "shared-openai-model",
		})
	})

	it("writes Z.AI Coding Plan API keys only to provider-specific settings", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({ zaiApiKey: "shared-zai-key" })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("zai-coding-plan")

		const written = store.write(providerId, { apiKey: "coding-plan-key" })

		expect(written).toEqual({ providerId, apiKey: "coding-plan-key" })
		expect(mocks.getSavedProviderSettings("zai-coding-plan")).toMatchObject({
			provider: "zai-coding-plan",
			apiKey: "coding-plan-key",
		})
		expect(mocks.getApiConfiguration().zaiApiKey).toBe("shared-zai-key")
	})

	it("resolves a bare state modelId with fallback metadata and ignores a bare modelInfo", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")

		// The mode-specific model id alone identifies the selection; commits
		// whose resolution was pure fallback intentionally leave the state
		// modelInfo snapshot unset.
		mocks.setApiConfiguration({ actModeOpenRouterModelId: "anthropic/claude-sonnet-4" })
		expect(store.readSelection(providerId, "act")).toMatchObject({
			providerId,
			modelId: "anthropic/claude-sonnet-4",
			modelInfoSource: "fallback",
		})

		// A modelInfo snapshot without a model id is not a selection.
		mocks.setApiConfiguration({ actModeOpenRouterModelInfo: modelInfoA })
		expect(store.readSelection(providerId, "act")).toBeUndefined()
	})

	it("keeps Plan and Act selections independent and mirrors the latest selection to provider settings", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({ planActSeparateModelsSetting: true })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const planSelection = selectionFromModelInfo(providerId, "provider/model-a", modelInfoA)
		const actSelection = selectionFromModelInfo(providerId, "provider/model-b", modelInfoB)

		store.commitSelection(providerId, "plan", planSelection)
		store.commitSelection(providerId, "act", actSelection)

		expectResolvedSelection(store.readSelection(providerId, "plan"), planSelection, modelInfoA)
		expectResolvedSelection(store.readSelection(providerId, "act"), actSelection, modelInfoB)
		expect(mocks.getSavedProviderSettings("openrouter")).toMatchObject({
			provider: "openrouter",
			model: "provider/model-b",
		})
		expect(mocks.getSavedProviderSettings("openrouter")).not.toHaveProperty("contextWindow")
		expect(mocks.getSavedProviderSettings("openrouter")).not.toHaveProperty("maxTokens")
	})

	it("updates providers.json model with setLastUsed false when planActSeparateModelsSetting=false", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({ planActSeparateModelsSetting: false })
		mocks.setProviderSettings({
			openrouter: { provider: "openrouter", apiKey: "existing-key", contextWindow: 64_000, maxTokens: 4_096 },
		})
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const selection = selectionFromModelInfo(providerId, "provider/model-a", modelInfoA)

		store.commitSelection(providerId, "act", selection)

		expect(mocks.getSavedProviderSettings("openrouter")).toMatchObject({
			provider: "openrouter",
			apiKey: "existing-key",
			model: "provider/model-a",
		})
		expect(mocks.getSavedProviderSettings("openrouter")).not.toHaveProperty("contextWindow")
		expect(mocks.getSavedProviderSettings("openrouter")).not.toHaveProperty("maxTokens")
		expect(mocks.getSaveProviderSettingsMock()).toHaveBeenCalledWith(expect.objectContaining({ model: "provider/model-a" }), {
			setLastUsed: false,
		})
	})

	it("persists Claude Code model selections to providers.json", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("claude-code")
		const selection = selectionFromModelInfo(providerId, "haiku", modelInfoA)

		store.commitSelection(providerId, "act", selection)

		expect(mocks.getSavedProviderSettings("claude-code")).toMatchObject({
			provider: "claude-code",
			model: "haiku",
		})
		expect(mocks.getSavedProviderSettings("claude-code")).not.toHaveProperty("contextWindow")
		expect(mocks.getSavedProviderSettings("claude-code")).not.toHaveProperty("maxTokens")
		expect(mocks.getSaveProviderSettingsMock()).toHaveBeenCalledWith(expect.objectContaining({ model: "haiku" }), {
			setLastUsed: false,
		})
	})

	it("subscribers fire synchronously and multiple writes emit events in order", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("deepseek")
		const events: ProviderConfigChange[] = []
		let fired = false

		store.subscribe((event) => {
			fired = true
			events.push(event)
		})

		const first = store.write(providerId, { apiKey: "first" })
		expect(fired).toBe(true)
		const second = store.write(providerId, { apiKey: "second" })

		expect(events).toEqual([
			{ kind: "fields", providerId, config: first },
			{ kind: "fields", providerId, config: second },
		])
	})

	it("write emits fields, commitSelection emits selection, and write never emits selection", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const events: ProviderConfigChange[] = []
		const selection = selectionFromModelInfo(providerId, "provider/model-a", modelInfoA)

		store.subscribe((event) => events.push(event))
		store.write(providerId, { apiKey: "openrouter-key" })
		store.commitSelection(providerId, "act", selection)

		expect(events.map((event) => event.kind)).toEqual(["fields", "selection"])
		expect(events[0]).toMatchObject({ kind: "fields", providerId })
		expect(events[1]).toEqual({
			kind: "selection",
			providerId,
			mode: "act",
			selection: store.readSelection(providerId, "act"),
		})
	})

	it("dispose unregisters listeners", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("deepseek")
		const listener = vi.fn()
		const disposable = store.subscribe(listener)

		disposable.dispose()
		store.write(providerId, { apiKey: "deepseek-key" })

		expect(listener).not.toHaveBeenCalled()
	})

	// Contract test against the REAL SDK schemas (imported by relative path,
	// bypassing the @cline/core mock above): the store's converters must pass
	// every SDK capability through, and a fully-populated stored entry must
	// parse under the schema `writeModelsFileSync` enforces in production.
	it("round-trips every SDK model capability and a full override set under the real stored-entry schema", async () => {
		const { ModelCapabilitySchema } = await import("@cline/shared")
		// vi.importActual bypasses the @cline/core mock above and resolves via
		// the vitest alias to the stub, which re-exports the real schema.
		const { StoredModelEntrySchema } = (await vi.importActual("@cline/core")) as {
			StoredModelEntrySchema: { parse(input: unknown): unknown }
		}
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai")

		store.commitSelection(providerId, "act", {
			providerId,
			modelId: "contract-model",
			overrides: {
				name: "Contract Model",
				maxTokens: 1024,
				contextWindow: 200_000,
				maxInputTokens: 100_000,
				capabilities: [...ModelCapabilitySchema.options],
				supportsVision: true,
				supportsAttachments: true,
				supportsReasoning: true,
				inputPrice: 0.5,
				outputPrice: 1.5,
				cacheReadsPrice: 0.1,
				cacheWritesPrice: 0.2,
				temperature: 0.7,
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				isR1FormatRequired: true,
			},
		})

		const entry = mocks.getModelsFile().providers["openai-compatible"]?.models?.["contract-model"]
		expect(entry).toBeDefined()
		// No SDK capability may be silently stripped by the store's converter.
		expect([...(entry?.capabilities as string[])].sort()).toEqual([...ModelCapabilitySchema.options].sort())
		// The entry written by the extension must satisfy the real schema that
		// the SDK's writeModelsFileSync enforces.
		expect(() => StoredModelEntrySchema.parse(entry)).not.toThrow()
	})
})
