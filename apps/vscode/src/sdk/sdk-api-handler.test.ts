import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildSdkProviderConfig } from "./sdk-api-handler"

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getProviderConfig: vi.fn(),
		getProviderSettings: vi.fn(),
	}
	return {
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		providerSettingsManager,
		stateManager: {
			getApiConfiguration: vi.fn(() => ({})),
			getRemoteConfigSettings: vi.fn(() => ({})),
		},
	}
})

vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => mocks.stateManager,
	},
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		warn: vi.fn(),
	},
}))

describe("buildSdkProviderConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.providerSettingsManager.getProviderConfig.mockReturnValue(undefined)
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
		mocks.stateManager.getApiConfiguration.mockReturnValue({})
		mocks.stateManager.getRemoteConfigSettings.mockReturnValue({})
	})

	it("prefers SDK provider config and overlays the mode-specific model", () => {
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId !== "bedrock") {
				return undefined
			}
			return {
				providerId: "bedrock",
				modelId: "sdk-default",
				apiKey: "sdk-bedrock-key",
				region: "us-west-2",
				aws: {
					authentication: "apikey",
					customModelBaseId: "base-profile",
				},
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "bedrock",
				actModeApiModelId: "bedrock-model",
				awsBedrockApiKey: "legacy-bedrock-key",
				awsRegion: "us-east-1",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "bedrock",
			modelId: "bedrock-model",
			apiKey: "sdk-bedrock-key",
			region: "us-west-2",
			aws: {
				authentication: "apikey",
				customModelBaseId: "base-profile",
			},
		})
		expect(mocks.providerSettingsManager.getProviderConfig).toHaveBeenCalledWith("bedrock", {
			includeKnownModels: false,
		})
	})

	it("fills missing persisted Bedrock settings from legacy state for standalone handlers", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			awsRegion: "us-east-1",
			awsUseGlobalInference: true,
		})
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId !== "bedrock") {
				return undefined
			}
			return {
				providerId: "bedrock",
				modelId: "sdk-default",
				apiKey: "sdk-bedrock-key",
				aws: {
					authentication: "api-key",
				},
			}
		})
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "bedrock") {
				return undefined
			}
			return {
				provider: "bedrock",
				apiKey: "sdk-bedrock-key",
				aws: {
					authentication: "api-key",
				},
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "bedrock",
				actModeApiModelId: "bedrock-model",
				awsBedrockApiKey: "legacy-bedrock-key",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "bedrock",
			modelId: "bedrock-model",
			apiKey: "sdk-bedrock-key",
			region: "us-east-1",
			useGlobalInference: true,
			aws: {
				authentication: "api-key",
				region: "us-east-1",
				useGlobalInference: true,
			},
		})
	})

	it("does not pass stale Bedrock API keys when legacy credentials auth maps to IAM", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			awsAuthentication: "credentials",
			awsBedrockApiKey: "stale-bedrock-api-key",
			awsRegion: "us-east-1",
		})
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId !== "bedrock") {
				return undefined
			}
			return {
				providerId: "bedrock",
				modelId: "sdk-default",
				apiKey: "persisted-stale-bedrock-api-key",
				aws: {
					authentication: "iam",
				},
			}
		})
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "bedrock") {
				return undefined
			}
			return {
				provider: "bedrock",
				apiKey: "persisted-stale-bedrock-api-key",
				aws: {
					authentication: "iam",
				},
			}
		})
		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "bedrock",
				actModeApiModelId: "bedrock-model",
				awsAuthentication: "credentials",
				awsBedrockApiKey: "stale-bedrock-api-key",
				awsRegion: "us-east-1",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "bedrock",
			modelId: "bedrock-model",
			region: "us-east-1",
			aws: {
				authentication: "iam",
				region: "us-east-1",
			},
		})
		expect(providerConfig).not.toHaveProperty("apiKey")
	})

	it("uses legacy OpenAI-compatible base URL when persisted settings only produce SDK defaults", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			openAiBaseUrl: "http://localhost:8000/v1",
			azureApiVersion: "2025-01-01-preview",
		})
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId !== "openai-compatible") {
				return undefined
			}
			return {
				providerId: "openai-compatible",
				modelId: "sdk-model",
				apiKey: "sdk-openai-compatible-key",
				baseUrl: "https://api.openai.com/v1",
			}
		})
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "openai-compatible") {
				return undefined
			}
			return {
				provider: "openai-compatible",
				apiKey: "sdk-openai-compatible-key",
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "openai",
				actModeOpenAiModelId: "custom-chat-model",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "openai-compatible",
			modelId: "custom-chat-model",
			apiKey: "sdk-openai-compatible-key",
			baseUrl: "http://localhost:8000/v1",
			azure: {
				apiVersion: "2025-01-01-preview",
			},
		})
	})

	it("does not return stale persisted providerConfig reasoning fields for standalone handlers", () => {
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId !== "openai-compatible") {
				return undefined
			}
			return {
				providerId: "openai-compatible",
				modelId: "sdk-model",
				apiKey: "sdk-openai-compatible-key",
				thinking: false,
				reasoningEffort: "high",
				thinkingBudgetTokens: 4096,
			}
		})
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "openai-compatible") {
				return undefined
			}
			return {
				provider: "openai-compatible",
				reasoning: {
					enabled: false,
					effort: "high",
					budgetTokens: 4096,
				},
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "openai",
				actModeOpenAiModelId: "custom-chat-model",
			},
			"act",
		)

		expect(providerConfig.thinking).toBeUndefined()
		expect(providerConfig.reasoningEffort).toBeUndefined()
		expect(providerConfig).not.toHaveProperty("thinkingBudgetTokens")
	})

	it("overlays legacy OCA mode and base URL for standalone handlers", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			ocaMode: "internal",
			ocaBaseUrl: "https://internal.oca.example/v1",
		})
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId !== "oca") {
				return undefined
			}
			return {
				providerId: "oca",
				modelId: "sdk-oca-default",
				baseUrl: "https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
			}
		})
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "oca") {
				return undefined
			}
			return {
				provider: "oca",
				baseUrl: "https://stale-migrated.oca.example/v1",
				oca: { mode: "external" },
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "oca",
				actModeOcaModelId: "anthropic/claude-3-7-sonnet-20250219",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "oca",
			modelId: "anthropic/claude-3-7-sonnet-20250219",
			baseUrl: "https://internal.oca.example/v1",
			oca: {
				mode: "internal",
			},
		})
	})

	it("fills Vertex runtime config from legacy state", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			vertexProjectId: "legacy-project",
			vertexRegion: "us-central1",
		})
		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "vertex",
				actModeApiModelId: "gemini-2.5-pro",
				vertexProjectId: "legacy-project",
				vertexRegion: "us-central1",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "vertex",
			modelId: "gemini-2.5-pro",
			region: "us-central1",
			gcp: {
				projectId: "legacy-project",
				region: "us-central1",
			},
		})
	})

	it("prefers persisted Vertex SDK config while preserving the mode-selected model", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			vertexProjectId: "legacy-project",
			vertexRegion: "us-central1",
		})
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId !== "vertex") {
				return undefined
			}
			return {
				providerId: "vertex",
				modelId: "sdk-default",
				gcp: {
					projectId: "sdk-project",
					region: "europe-west4",
				},
			}
		})
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "vertex") {
				return undefined
			}
			return {
				provider: "vertex",
				gcp: {
					projectId: "sdk-project",
					region: "europe-west4",
				},
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "vertex",
				actModeApiModelId: "gemini-2.5-pro",
				vertexProjectId: "legacy-project",
				vertexRegion: "us-central1",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "vertex",
			modelId: "gemini-2.5-pro",
			region: "europe-west4",
			gcp: {
				projectId: "sdk-project",
				region: "europe-west4",
			},
		})
	})

	it("prefers act-mode SAP and Bedrock legacy fields over single persisted SDK values", () => {
		mocks.providerSettingsManager.getProviderConfig.mockImplementation((providerId: string) => {
			if (providerId === "sapaicore") {
				return {
					providerId: "sapaicore",
					modelId: "sdk-default",
					sap: { deploymentId: "persisted-deployment" },
				}
			}
			if (providerId === "bedrock") {
				return {
					providerId: "bedrock",
					modelId: "sdk-default",
					apiKey: "bedrock-key",
					aws: { authentication: "api-key", customModelBaseId: "persisted-base" },
				}
			}
			return undefined
		})
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId === "sapaicore") {
				return { provider: "sapaicore", sap: { deploymentId: "persisted-deployment" } }
			}
			if (providerId === "bedrock") {
				return {
					provider: "bedrock",
					apiKey: "bedrock-key",
					aws: { authentication: "api-key", customModelBaseId: "persisted-base" },
				}
			}
			return undefined
		})

		expect(
			buildSdkProviderConfig(
				{
					planModeApiProvider: "sapaicore",
					planModeSapAiCoreModelId: "anthropic--claude-3.5-sonnet",
					planModeSapAiCoreDeploymentId: "plan-deployment",
					actModeSapAiCoreDeploymentId: "act-deployment",
				},
				"plan",
			),
		).toMatchObject({
			providerId: "sapaicore",
			modelId: "anthropic--claude-3.5-sonnet",
			sap: { deploymentId: "act-deployment" },
		})
		expect(
			buildSdkProviderConfig(
				{
					planModeApiProvider: "bedrock",
					planModeApiModelId: "bedrock-model",
					planModeAwsBedrockCustomModelBaseId: "plan-base",
					actModeAwsBedrockCustomModelBaseId: "act-base",
					awsAuthentication: "api-key",
					awsBedrockApiKey: "bedrock-key",
				},
				"plan",
			),
		).toMatchObject({
			providerId: "bedrock",
			modelId: "bedrock-model",
			apiKey: "bedrock-key",
			aws: { authentication: "api-key", customModelBaseId: "act-base" },
		})
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
				actModeClinePassModelId: "cline-pass/glm-5.1",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "cline-pass",
			modelId: "cline-pass/glm-5.1",
			apiKey: "workos:shared-cline-token",
		})
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("cline")
	})

	it("falls unsupported persisted providers back to the VS Code runtime default", () => {
		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "qwen-code",
				actModeApiModelId: "qwen-code-model",
				qwenApiKey: "qwen-code-key",
			},
			"act",
		)

		expect(providerConfig.providerId).toBe("cline")
		expect(providerConfig.modelId).not.toBe("qwen-code-model")
		expect(providerConfig).not.toHaveProperty("apiKey", "qwen-code-key")
	})
})
