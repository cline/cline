import type { ApiConfiguration } from "@shared/api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => {
	let apiConfiguration: ApiConfiguration = {}
	let remoteConfigSettings: ApiConfiguration = {}
	let providerSettingsById: Record<string, unknown> = {}

	return {
		setApiConfiguration(value: ApiConfiguration): void {
			apiConfiguration = value
		},
		setRemoteConfigSettings(value: ApiConfiguration): void {
			remoteConfigSettings = value
		},
		setProviderSettings(value: Record<string, unknown>): void {
			providerSettingsById = value
		},
		getStateManager() {
			return {
				getApiConfiguration: () => apiConfiguration,
				getRemoteConfigSettings: () => remoteConfigSettings,
			}
		},
		getProviderSettingsManager() {
			return { getProviderSettings: (providerId: string) => providerSettingsById[providerId] }
		},
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: mocks.getStateManager },
}))

vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

describe("buildEffectiveProviderConfig", () => {
	beforeEach(() => {
		mocks.setApiConfiguration({})
		mocks.setRemoteConfigSettings({})
		mocks.setProviderSettings({})
	})

	it("builds Ollama config from SDK provider settings when a provider record exists", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			ollama: {
				provider: "ollama",
				apiKey: "provider-ollama-key",
				baseUrl: "http://provider-ollama:11434",
			},
		})
		mocks.setApiConfiguration({
			ollamaBaseUrl: "http://state-ollama:11434",
			ollamaApiOptionsCtxNum: "8192",
		})

		expect(buildEffectiveProviderConfig(parseProviderId("ollama"))).toEqual({
			providerId: parseProviderId("ollama"),
			apiKey: "provider-ollama-key",
			baseUrl: "http://provider-ollama:11434",
		})
	})

	it("builds LiteLLM config from SDK provider settings without StateManager overlays", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			litellm: {
				provider: "litellm",
				apiKey: "provider-litellm-key",
				baseUrl: "https://provider-litellm.example.com/v1",
				headers: { "x-provider": "provider-header" },
				extras: { providerOnly: true },
			},
		})
		mocks.setApiConfiguration({
			liteLlmBaseUrl: "https://state-litellm.example.com/v1",
			liteLlmUsePromptCache: true,
		})

		expect(buildEffectiveProviderConfig(parseProviderId("litellm"))).toEqual({
			providerId: parseProviderId("litellm"),
			apiKey: "provider-litellm-key",
			baseUrl: "https://provider-litellm.example.com/v1",
			headers: { "x-provider": "provider-header" },
			extras: { providerOnly: true },
		})
	})

	it("uses SDK provider settings over stale StateManager DeepSeek keys", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({ deepseek: { provider: "deepseek", apiKey: "provider-deepseek-key" } })
		mocks.setApiConfiguration({ deepSeekApiKey: "state-deepseek-key" })

		expect(buildEffectiveProviderConfig(parseProviderId("deepseek"))).toEqual({
			providerId: parseProviderId("deepseek"),
			apiKey: "provider-deepseek-key",
		})
	})

	it("reads normalized nousResearch API key from SDK provider settings", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({ nousresearch: { provider: "nousresearch", apiKey: "provider-nous-key" } })
		mocks.setApiConfiguration({ nousResearchApiKey: "state-nous-key" })

		expect(buildEffectiveProviderConfig(parseProviderId("nousResearch"))).toEqual({
			providerId: parseProviderId("nousResearch"),
			apiKey: "provider-nous-key",
		})
	})

	it("hydrates OpenAI-compatible SDK config from provider settings", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			"openai-compatible": {
				provider: "openai-compatible",
				apiKey: "provider-openai-key",
				baseUrl: "https://provider.example/v1",
				azure: { apiVersion: "2024-02-15-preview" },
			},
		})
		mocks.setApiConfiguration({
			openAiApiKey: "state-openai-key",
			openAiBaseUrl: "https://state.example/v1",
			openAiHeaders: { "x-provider": "state" },
			azureApiVersion: "2025-01-01-preview",
		})

		expect(buildEffectiveProviderConfig(parseProviderId("openai-compatible"))).toEqual({
			providerId: parseProviderId("openai-compatible"),
			apiKey: "provider-openai-key",
			baseUrl: "https://provider.example/v1",
			azure: { apiVersion: "2024-02-15-preview" },
		})
	})

	it("carries Qwen apiLine from SDK provider settings", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({ qwen: { provider: "qwen", apiKey: "provider-qwen-key", apiLine: "china" } })
		mocks.setApiConfiguration({ qwenApiKey: "state-qwen-key", qwenApiLine: "international" })

		expect(buildEffectiveProviderConfig(parseProviderId("qwen"))).toEqual({
			providerId: parseProviderId("qwen"),
			apiKey: "provider-qwen-key",
			apiLine: "china",
		})
	})

	it("respects remote-config-locked LiteLLM key over SDK provider settings", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			litellm: {
				provider: "litellm",
				apiKey: "local-litellm-key-from-providers-json",
				baseUrl: "https://provider-litellm.example.com/v1",
			},
		})
		mocks.setRemoteConfigSettings({
			liteLlmApiKey: "remote-config-locked-litellm-key",
			liteLlmBaseUrl: "https://remote-litellm.example.com/v1",
		})

		expect(buildEffectiveProviderConfig(parseProviderId("litellm"))).toEqual({
			providerId: parseProviderId("litellm"),
			apiKey: "remote-config-locked-litellm-key",
			baseUrl: "https://remote-litellm.example.com/v1",
		})
	})

	it("falls back to legacy StateManager provider fields when SDK provider settings do not exist", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setApiConfiguration({
			openAiApiKey: "state-openai-key",
			openAiBaseUrl: "https://state.example/v1",
			openAiHeaders: { "x-provider": "state" },
			azureApiVersion: "2025-01-01-preview",
		})

		expect(buildEffectiveProviderConfig(parseProviderId("openai-compatible"))).toEqual({
			providerId: parseProviderId("openai-compatible"),
			apiKey: "state-openai-key",
			baseUrl: "https://state.example/v1",
			headers: { "x-provider": "state" },
			azure: { apiVersion: "2025-01-01-preview" },
		})
	})

	it("keeps Cline account auth in the auth envelope", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setApiConfiguration({ clineApiKey: "cline-access-token", clineAccountId: "account-123" })

		expect(buildEffectiveProviderConfig(parseProviderId("cline"))).toEqual({
			providerId: parseProviderId("cline"),
			apiKey: "cline-access-token",
			auth: { accessToken: "cline-access-token", accountId: "account-123" },
		})
	})
})
