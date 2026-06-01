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
			extras: { ollamaApiOptionsCtxNum: "8192" },
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

	it("reads normalized nousResearch API key from StateManager", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({ nousresearch: { provider: "nousresearch", apiKey: "provider-nous-key" } })
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

	it("merges Bedrock providers.json aws settings with StateManager overlays", async () => {
		const { buildEffectiveProviderConfig } = await import("./effective-config")
		mocks.setProviderSettings({
			bedrock: {
				provider: "bedrock",
				apiKey: "provider-bedrock-api-key",
				aws: {
					region: "us-west-2",
					authentication: "profile",
					profile: "dev-profile",
					useCrossRegionInference: true,
					customModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				},
			},
		})
		mocks.setApiConfiguration({
			awsRegion: "us-east-1",
			awsBedrockUsePromptCache: true,
		})

		expect(buildEffectiveProviderConfig(parseProviderId("bedrock"))).toEqual({
			providerId: parseProviderId("bedrock"),
			apiKey: "provider-bedrock-api-key",
			region: "us-east-1",
			aws: {
				region: "us-east-1",
				authentication: "profile",
				profile: "dev-profile",
				useCrossRegionInference: true,
				usePromptCache: true,
				customModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			},
			extras: {
				awsBedrockUsePromptCache: true,
			},
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
