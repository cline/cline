import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildApiHandler, buildSdkProviderConfig } from "./sdk-api-handler"

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getProviderSettings: vi.fn(),
		getProviderConfig: vi.fn(),
	}
	return {
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		providerSettingsManager,
		resolveProviderApiKey: vi.fn(),
		fetch: vi.fn(),
		createHandler: vi.fn(() => ({ getModel: () => ({ id: "model", info: {} }) })),
	}
})

vi.mock("@cline/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/core")>()),
	RuntimeOAuthTokenManager: class {
		resolveProviderApiKey = mocks.resolveProviderApiKey
	},
}))

vi.mock("@cline/llms", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/llms")>()),
	createHandler: mocks.createHandler,
}))

vi.mock("@/shared/net", () => ({ fetch: mocks.fetch }))

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

	it("loads the saved ChatGPT grant and rechecks credentials before each standalone request", async () => {
		const chatgptPlan = {
			clientId: "oaiapp_test",
			subject: "account",
			issuer: "https://auth.openai.com",
			scopes: ["chatgpt.tokens.use.direct"],
		}
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
		mocks.providerSettingsManager.getProviderConfig.mockReturnValue({ apiKey: "old-token", chatgptPlan })
		mocks.resolveProviderApiKey.mockResolvedValue({ apiKey: "fresh-token" })
		mocks.fetch.mockResolvedValue(new Response("ok"))
		buildApiHandler({ actModeApiProvider: "openai-chatgpt", actModeApiModelId: "plan-model" }, "act")
		const config = (mocks.createHandler.mock.calls as unknown as [[import("@cline/llms").ProviderConfig]])[0][0]
		expect(config.chatgptPlan).toEqual(chatgptPlan)
		expect(config.apiKey).toBe("old-token")
		await config.fetch!("https://api.openai.com/v1/responses", {
			method: "POST",
			headers: { Authorization: "Bearer old-token", "Content-Type": "application/json" },
			body: "{}",
		})
		expect(mocks.resolveProviderApiKey).toHaveBeenCalledWith({ providerId: "openai-chatgpt" })
		const sentHeaders = mocks.fetch.mock.calls[0][1].headers as Headers
		expect(sentHeaders.get("Authorization")).toBe("Bearer fresh-token")
		expect(sentHeaders.get("Content-Type")).toBe("application/json")

		// A utility handler may outlive sign-out or a refresh that removes scope.
		mocks.resolveProviderApiKey.mockRejectedValue(new Error("Reauthentication required"))
		await expect(config.fetch!("https://api.openai.com/v1/responses")).rejects.toThrow("Reauthentication required")
		expect(mocks.fetch).toHaveBeenCalledTimes(1)
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
