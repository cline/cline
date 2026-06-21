import type { ApiConfiguration, ModelInfo } from "@shared/api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderConfigChange } from "./contracts"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => {
	type MockApiConfiguration = ApiConfiguration
	let apiConfiguration: MockApiConfiguration = {}
	let providerSettingsById: Record<string, Record<string, unknown>> = {}
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
			saveProviderSettings.mockClear()
		},
		setApiConfiguration(value: MockApiConfiguration): void {
			apiConfiguration = { ...value }
		},
		setProviderSettings(value: Record<string, Record<string, unknown>>): void {
			providerSettingsById = { ...value }
		},
		getSavedProviderSettings(providerId: string): Record<string, unknown> | undefined {
			return providerSettingsById[providerId]
		},
		getSaveProviderSettingsMock(): typeof saveProviderSettings {
			return saveProviderSettings
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

const modelInfoA: ModelInfo = {
	name: "Model A",
	contextWindow: 128_000,
	maxTokens: 8_192,
	supportsPromptCache: true,
}

const modelInfoB: ModelInfo = {
	name: "Model B",
	contextWindow: 64_000,
	maxTokens: 4_096,
	supportsPromptCache: false,
}

describe("createProviderConfigStore", () => {
	beforeEach(() => {
		mocks.reset()
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

	it("writes generic Bedrock SDK settings without mirroring legacy provider keys", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("bedrock")

		store.write(providerId, {
			settings: {
				apiKey: "bedrock-api-key",
				aws: {
					authentication: "api-key",
					region: "us-west-2",
					accessKey: "access-key",
					secretKey: "secret-key",
					sessionToken: "session-token",
					endpoint: "https://bedrock.example",
					customModelBaseId: "base-profile",
					useCrossRegionInference: true,
					useGlobalInference: false,
					usePromptCache: true,
				},
			},
			apiKey: "bedrock-api-key",
			aws: {
				authentication: "api-key",
				region: "us-west-2",
				accessKey: "access-key",
				secretKey: "secret-key",
				sessionToken: "session-token",
				endpoint: "https://bedrock.example",
				customModelBaseId: "base-profile",
				useCrossRegionInference: true,
				useGlobalInference: false,
				usePromptCache: true,
			},
		})

		expect(mocks.getSavedProviderSettings("bedrock")).toMatchObject({
			provider: "bedrock",
			apiKey: "bedrock-api-key",
			aws: {
				authentication: "api-key",
				region: "us-west-2",
				customModelBaseId: "base-profile",
			},
		})
		expect(mocks.getStateManager().getApiConfiguration()).toEqual({})
	})

	it("stores formerly mode-scoped Bedrock and SAP SDK fields as provider settings", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({
			planModeAwsBedrockCustomModelBaseId: "old-plan-base",
			actModeAwsBedrockCustomModelBaseId: "old-act-base",
			planModeSapAiCoreDeploymentId: "old-plan-deployment",
			actModeSapAiCoreDeploymentId: "old-act-deployment",
		})
		mocks.setProviderSettings({
			bedrock: { provider: "bedrock", aws: { customModelBaseId: "provider-wide-base" } },
			sapaicore: { provider: "sapaicore", sap: { deploymentId: "provider-wide-deployment" } },
		})
		const store = createProviderConfigStore()

		store.write(parseProviderId("bedrock"), {
			mode: "plan",
			settings: { aws: { customModelBaseId: "new-plan-base" } },
			aws: { customModelBaseId: "new-plan-base" },
		})
		store.write(parseProviderId("sapaicore"), {
			mode: "act",
			settings: { sap: { deploymentId: "new-act-deployment" } },
			sap: { deploymentId: "new-act-deployment" },
		})

		expect(mocks.getStateManager().getApiConfiguration()).toMatchObject({
			planModeAwsBedrockCustomModelBaseId: "old-plan-base",
			actModeAwsBedrockCustomModelBaseId: "old-act-base",
			planModeSapAiCoreDeploymentId: "old-plan-deployment",
			actModeSapAiCoreDeploymentId: "old-act-deployment",
		})
		expect(mocks.getSavedProviderSettings("bedrock")).toMatchObject({
			provider: "bedrock",
			aws: { customModelBaseId: "new-plan-base" },
		})
		expect(mocks.getSavedProviderSettings("sapaicore")).toMatchObject({
			provider: "sapaicore",
			sap: { deploymentId: "new-act-deployment" },
		})
	})

	it("writes OpenAI-compatible SDK settings without mirroring legacy OpenAI keys", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()

		store.write(parseProviderId("openai-compatible"), {
			settings: {
				apiKey: "openai-compatible-key",
				baseUrl: "https://compatible.example/v1",
				headers: { "x-provider": "compatible" },
				azure: { apiVersion: "2025-01-01-preview" },
			},
			apiKey: "openai-compatible-key",
			baseUrl: "https://compatible.example/v1",
			headers: { "x-provider": "compatible" },
			azure: { apiVersion: "2025-01-01-preview" },
		})

		expect(mocks.getSavedProviderSettings("openai-compatible")).toMatchObject({
			provider: "openai-compatible",
			apiKey: "openai-compatible-key",
			baseUrl: "https://compatible.example/v1",
			headers: { "x-provider": "compatible" },
			azure: { apiVersion: "2025-01-01-preview" },
		})
		expect(mocks.getStateManager().getApiConfiguration()).toEqual({})
	})

	it("writes generic SAP and OCA SDK settings without mirroring legacy provider keys", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()

		store.write(parseProviderId("sapaicore"), {
			settings: {
				baseUrl: "https://sap.example",
				sap: {
					clientId: "sap-client",
					clientSecret: "sap-secret",
					tokenUrl: "https://auth.sap.example",
					resourceGroup: "sap-group",
					deploymentId: "sap-deployment",
					useOrchestrationMode: true,
				},
			},
			baseUrl: "https://sap.example",
			sap: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.sap.example",
				resourceGroup: "sap-group",
				deploymentId: "sap-deployment",
				useOrchestrationMode: true,
			},
		})
		store.write(parseProviderId("oca"), {
			settings: { baseUrl: "https://oca.example", oca: { mode: "external", usePromptCache: true } },
			baseUrl: "https://oca.example",
			oca: { mode: "external", usePromptCache: true },
		})

		expect(mocks.getSavedProviderSettings("sapaicore")).toMatchObject({
			provider: "sapaicore",
			baseUrl: "https://sap.example",
			sap: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.sap.example",
				resourceGroup: "sap-group",
				deploymentId: "sap-deployment",
				useOrchestrationMode: true,
			},
		})
		expect(mocks.getSavedProviderSettings("oca")).toMatchObject({
			provider: "oca",
			baseUrl: "https://oca.example",
			oca: { mode: "external", usePromptCache: true },
		})
		expect(mocks.getStateManager().getApiConfiguration()).toEqual({})
	})

	it("round-trips commitSelection then readSelection for provider-specific model info", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const selection = { providerId, modelId: "anthropic/claude-sonnet-4", modelInfo: modelInfoA }

		store.commitSelection(providerId, "act", selection)

		expect(store.readSelection(providerId, "act")).toEqual(selection)
	})

	it("round-trips generic provider selections using the in-process modelInfo envelope", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("deepseek")
		const selection = { providerId, modelId: "deepseek-v4-pro", modelInfo: modelInfoA }

		store.commitSelection(providerId, "act", selection)

		expect(store.readSelection(providerId, "act")).toEqual(selection)
	})

	it("hydrates a generic provider selection from providers.json after reload", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setProviderSettings({ zai: { provider: "zai", model: "manual-zai-model" } })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("zai")

		expect(store.readSelection(providerId, "act")).toEqual({
			providerId,
			modelId: "manual-zai-model",
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
		const geminiSelection = { providerId: geminiProviderId, modelId: "gemini-3.1-pro-preview", modelInfo: modelInfoA }
		const deepSeekSelection = { providerId: deepSeekProviderId, modelId: "deepseek-v4-pro", modelInfo: modelInfoB }

		store.commitSelection(geminiProviderId, "act", geminiSelection)
		store.commitSelection(deepSeekProviderId, "act", deepSeekSelection)

		expect(store.readSelection(geminiProviderId, "act")).toEqual(geminiSelection)
		expect(store.readSelection(deepSeekProviderId, "act")).toEqual(deepSeekSelection)
	})

	it("handles normalized nousResearch provider casing for writes and selections", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("nousResearch")
		const selection = { providerId, modelId: "nousresearch/hermes-4-70b", modelInfo: modelInfoA }

		const written = store.write(providerId, { apiKey: "nous-key" })
		store.commitSelection(providerId, "act", selection)

		expect(written).toEqual({ providerId, apiKey: "nous-key" })
		expect(store.readSelection(providerId, "act")).toEqual(selection)
		expect(mocks.getSavedProviderSettings("nousResearch")).toMatchObject({
			provider: "nousResearch",
			apiKey: "nous-key",
			model: "nousresearch/hermes-4-70b",
		})
	})

	it("returns undefined from readSelection when modelId or modelInfo is missing", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")

		mocks.setApiConfiguration({ actModeOpenRouterModelId: "anthropic/claude-sonnet-4" })
		expect(store.readSelection(providerId, "act")).toBeUndefined()

		mocks.setApiConfiguration({ actModeOpenRouterModelInfo: modelInfoA })
		expect(store.readSelection(providerId, "act")).toBeUndefined()
	})

	it("uses the latest provider setting selection for both modes", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const planSelection = { providerId, modelId: "provider/model-a", modelInfo: modelInfoA }
		const actSelection = { providerId, modelId: "provider/model-b", modelInfo: modelInfoB }

		store.commitSelection(providerId, "plan", planSelection)
		store.commitSelection(providerId, "act", actSelection)

		expect(store.readSelection(providerId, "plan")).toEqual(actSelection)
		expect(store.readSelection(providerId, "act")).toEqual(actSelection)
		expect(mocks.getSavedProviderSettings("openrouter")).toMatchObject({
			provider: "openrouter",
			model: "provider/model-b",
			contextWindow: 64_000,
			maxTokens: 4_096,
		})
	})

	it("updates providers.json model with setLastUsed false", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setProviderSettings({ openrouter: { provider: "openrouter", apiKey: "existing-key" } })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const selection = { providerId, modelId: "provider/model-a", modelInfo: modelInfoA }

		store.commitSelection(providerId, "act", selection)

		expect(mocks.getSavedProviderSettings("openrouter")).toMatchObject({
			provider: "openrouter",
			apiKey: "existing-key",
			model: "provider/model-a",
		})
		expect(mocks.getSaveProviderSettingsMock()).toHaveBeenCalledWith(expect.objectContaining({ model: "provider/model-a" }), {
			setLastUsed: false,
		})
	})

	it("persists Claude Code model selections to providers.json", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("claude-code")
		const selection = { providerId, modelId: "haiku", modelInfo: modelInfoA }

		store.commitSelection(providerId, "act", selection)

		expect(mocks.getSavedProviderSettings("claude-code")).toMatchObject({
			provider: "claude-code",
			model: "haiku",
			contextWindow: 128_000,
			maxTokens: 8_192,
		})
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
		const selection = { providerId, modelId: "provider/model-a", modelInfo: modelInfoA }

		store.subscribe((event) => events.push(event))
		store.write(providerId, { apiKey: "openrouter-key" })
		store.commitSelection(providerId, "act", selection)

		expect(events.map((event) => event.kind)).toEqual(["fields", "selection"])
		expect(events[0]).toMatchObject({ kind: "fields", providerId })
		expect(events[1]).toEqual({ kind: "selection", providerId, mode: "act", selection })
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
})
