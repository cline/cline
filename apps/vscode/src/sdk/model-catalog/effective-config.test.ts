import type { ApiConfiguration } from "@shared/api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => {
	let apiConfiguration: ApiConfiguration = {}
	let providerSettingsById: Record<string, unknown> = {}

	return {
		setApiConfiguration(value: ApiConfiguration): void {
			apiConfiguration = value
		},
		setProviderSettings(value: Record<string, unknown>): void {
			providerSettingsById = value
		},
		getStateManager() {
			return { getApiConfiguration: () => apiConfiguration }
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
		mocks.setProviderSettings({})
	})

	it("builds Ollama config with StateManager base URL over providers.json and local extras", async () => {
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
			baseUrl: "http://state-ollama:11434",
			// The legacy state string surfaces as the provider-neutral
			// contextWindow when providers.json has none.
			contextWindow: 8192,
		})
	})

	it("prefers the providers.json contextWindow over the legacy Ollama state key", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			ollama: {
				provider: "ollama",
				contextWindow: 65536,
			},
		})
		mocks.setApiConfiguration({
			ollamaApiOptionsCtxNum: "8192",
		})

		expect(buildEffectiveProviderConfig(parseProviderId("ollama"))).toEqual({
			providerId: parseProviderId("ollama"),
			contextWindow: 65536,
		})
	})

	it("builds LiteLLM config by merging providers.json fields and StateManager overlays", async () => {
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
			baseUrl: "https://state-litellm.example.com/v1",
			headers: { "x-provider": "provider-header" },
			extras: { providerOnly: true, liteLlmUsePromptCache: true },
		})
	})

	it("uses StateManager DeepSeek API key over providers.json", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({ deepseek: { provider: "deepseek", apiKey: "provider-deepseek-key" } })
		mocks.setApiConfiguration({ deepSeekApiKey: "state-deepseek-key" })

		expect(buildEffectiveProviderConfig(parseProviderId("deepseek"))).toEqual({
			providerId: parseProviderId("deepseek"),
			apiKey: "state-deepseek-key",
		})
	})

	it("reads migrated OpenAI Compatible settings from the SDK provider id", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			"openai-compatible": {
				provider: "openai-compatible",
				apiKey: "migrated-openai-compatible-key",
				baseUrl: "https://gateway.example.invalid/v1",
				headers: { "X-Test": "legacy-header" },
			},
		})

		expect(buildEffectiveProviderConfig(parseProviderId("openai"))).toEqual({
			providerId: parseProviderId("openai"),
			apiKey: "migrated-openai-compatible-key",
			baseUrl: "https://gateway.example.invalid/v1",
			headers: { "X-Test": "legacy-header" },
		})
	})

	it("reads normalized nousResearch API key from StateManager", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({ nousResearch: { provider: "nousResearch", apiKey: "provider-nous-key" } })
		mocks.setApiConfiguration({ nousResearchApiKey: "state-nous-key" })

		expect(buildEffectiveProviderConfig(parseProviderId("nousResearch"))).toEqual({
			providerId: parseProviderId("nousResearch"),
			apiKey: "state-nous-key",
		})
	})

	it("carries Qwen apiLine from StateManager effective configuration", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({ qwen: { provider: "qwen", apiKey: "provider-qwen-key", apiLine: "china" } })
		mocks.setApiConfiguration({ qwenApiKey: "state-qwen-key", qwenApiLine: "international" })

		expect(buildEffectiveProviderConfig(parseProviderId("qwen"))).toEqual({
			providerId: parseProviderId("qwen"),
			apiKey: "state-qwen-key",
			apiLine: "international",
		})
	})

	it("reads the Z.AI Coding Plan API key from provider-specific settings", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			"zai-coding-plan": { provider: "zai-coding-plan", apiKey: "provider-zai-coding-plan-key" },
		})
		mocks.setApiConfiguration({ zaiApiKey: "state-zai-key" })

		expect(buildEffectiveProviderConfig(parseProviderId("zai-coding-plan"))).toEqual({
			providerId: parseProviderId("zai-coding-plan"),
			apiKey: "provider-zai-coding-plan-key",
		})
	})

	it("does not reuse the legacy Z.AI API key for Z.AI Coding Plan", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			"zai-coding-plan": { provider: "zai-coding-plan" },
		})
		mocks.setApiConfiguration({ zaiApiKey: "state-zai-key" })

		expect(buildEffectiveProviderConfig(parseProviderId("zai-coding-plan"))).toEqual({
			providerId: parseProviderId("zai-coding-plan"),
		})
	})

	it("respects remote-config-locked LiteLLM key already applied by StateManager", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			litellm: {
				provider: "litellm",
				apiKey: "local-litellm-key-from-providers-json",
				baseUrl: "https://provider-litellm.example.com/v1",
			},
		})
		mocks.setApiConfiguration({
			liteLlmApiKey: "remote-config-locked-litellm-key",
			liteLlmBaseUrl: "https://remote-litellm.example.com/v1",
		})

		expect(buildEffectiveProviderConfig(parseProviderId("litellm"))).toEqual({
			providerId: parseProviderId("litellm"),
			apiKey: "remote-config-locked-litellm-key",
			baseUrl: "https://remote-litellm.example.com/v1",
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
