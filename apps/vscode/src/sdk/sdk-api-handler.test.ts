import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildSdkProviderConfig } from "./sdk-api-handler"

const previousLmStudioApiKey = process.env.LMSTUDIO_API_KEY

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getProviderSettings: vi.fn(),
	}
	return {
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		providerSettingsManager,
	}
})

vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		warn: vi.fn(),
	},
}))

describe("buildSdkProviderConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		if (previousLmStudioApiKey === undefined) {
			delete process.env.LMSTUDIO_API_KEY
		} else {
			process.env.LMSTUDIO_API_KEY = previousLmStudioApiKey
		}
	})

	it("uses shared Cline OAuth credentials for ClinePass direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "cline") {
				return undefined
			}
			return {
				provider: "cline",
				auth: {
					accessToken: "workos:shared-cline-token",
					refreshToken: "refresh-token",
				},
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "cline-pass/glm-5.2",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "cline-pass",
			modelId: "cline-pass/glm-5.2",
			apiKey: "workos:shared-cline-token",
		})
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("cline")
	})

	it("uses provider-specific settings for SDK-backed direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "v0") {
				return undefined
			}
			return {
				provider: "v0",
				apiKey: "v0-key",
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "v0",
				actModeApiModelId: "v0-1.5-md",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "v0",
			modelId: "v0-1.5-md",
			apiKey: "v0-key",
		})
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("v0")
	})

	it("uses the stored LM Studio provider key for direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "lmstudio",
			apiKey: "provider-lmstudio-key",
		})
		process.env.LMSTUDIO_API_KEY = "environment-key"
		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "lmstudio",
				actModeLmStudioModelId: "local-model",
				apiKey: "anthropic-key-should-not-be-used",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "provider-lmstudio-key",
		})
	})

	it("falls back to LMSTUDIO_API_KEY for direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
		process.env.LMSTUDIO_API_KEY = "environment-key"

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "lmstudio",
				actModeLmStudioModelId: "local-model",
			},
			"act",
		)

		expect(providerConfig.apiKey).toBe("environment-key")
	})

	it("forwards the Ollama request timeout and context window to standalone handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "ollama",
				actModeOllamaModelId: "qwen2.5:7b",
				requestTimeoutMs: 45_000,
				ollamaApiOptionsCtxNum: "16384",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "ollama",
			modelId: "qwen2.5:7b",
			timeoutMs: 45_000,
			modelInfo: { id: "qwen2.5:7b", contextWindow: 16384 },
		})
	})

	it("omits timeoutMs for Ollama when no explicit timeout is configured", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "ollama",
				actModeOllamaModelId: "qwen2.5:7b",
			},
			"act",
		)

		expect(providerConfig.providerId).toBe("ollama")
		expect("timeoutMs" in providerConfig).toBe(false)
	})
})
