import type { ApiConfiguration, ModelInfo } from "@shared/api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderConfigChange } from "./contracts"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => {
	type MockApiConfiguration = ApiConfiguration & { planActSeparateModelsSetting?: boolean }
	let apiConfiguration: MockApiConfiguration = {}
	let providerSettingsById: Record<string, Record<string, unknown>> = {}
	const saveProviderSettings = vi.fn((settings: Record<string, unknown>, options?: { setLastUsed?: boolean }) => {
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

	it("returns undefined from readSelection when modelId or modelInfo is missing", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")

		mocks.setApiConfiguration({ actModeOpenRouterModelId: "anthropic/claude-sonnet-4" })
		expect(store.readSelection(providerId, "act")).toBeUndefined()

		mocks.setApiConfiguration({ actModeOpenRouterModelInfo: modelInfoA })
		expect(store.readSelection(providerId, "act")).toBeUndefined()
	})

	it("keeps Plan and Act selections independent when planActSeparateModelsSetting=true", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({ planActSeparateModelsSetting: true })
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openrouter")
		const planSelection = { providerId, modelId: "provider/model-a", modelInfo: modelInfoA }
		const actSelection = { providerId, modelId: "provider/model-b", modelInfo: modelInfoB }

		store.commitSelection(providerId, "plan", planSelection)
		store.commitSelection(providerId, "act", actSelection)

		expect(store.readSelection(providerId, "plan")).toEqual(planSelection)
		expect(store.readSelection(providerId, "act")).toEqual(actSelection)
		expect(mocks.getSaveProviderSettingsMock()).not.toHaveBeenCalled()
	})

	it("updates providers.json model with setLastUsed false when planActSeparateModelsSetting=false", async () => {
		const { createProviderConfigStore } = await import("./store")
		mocks.setApiConfiguration({ planActSeparateModelsSetting: false })
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
