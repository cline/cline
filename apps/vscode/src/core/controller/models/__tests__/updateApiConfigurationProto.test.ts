import { describe, expect, it, vi } from "vitest"
import type { ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import {
	ApiProvider,
	LiteLLMModelInfo,
	ModelsApiConfiguration,
	OcaModelInfo,
	OpenAiCompatibleModelInfo,
	UpdateApiConfigurationRequest,
} from "@/shared/proto/cline/models"
import { updateApiConfigurationProto } from "../updateApiConfigurationProto"

function makeStore(): ProviderConfigStore {
	return {
		read: vi.fn((providerId) => ({ providerId })),
		readSelection: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		write: vi.fn((providerId) => ({ providerId })),
		commitSelection: vi.fn(),
	}
}

describe("updateApiConfigurationProto", () => {
	it("preserves SDK-only provider ids from provider_id string fields", async () => {
		const previousConfig = {
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
		}
		const setApiConfiguration = vi.fn()
		const controller = {
			getProviderConfigStore: () => makeStore(),
			stateManager: {
				getApiConfiguration: vi.fn(() => previousConfig),
				setApiConfiguration,
				getGlobalSettingsKey: vi.fn(() => "act"),
			},
			handleApiConfigurationChanged: vi.fn(),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		await updateApiConfigurationProto(
			controller,
			UpdateApiConfigurationRequest.create({
				apiConfiguration: ModelsApiConfiguration.create({
					actModeApiProviderId: "poolside",
				}),
			}),
		)

		expect(setApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				actModeApiProvider: "poolside",
			}),
		)
		expect(controller.handleApiConfigurationChanged).toHaveBeenCalledWith(
			previousConfig,
			expect.objectContaining({
				actModeApiProvider: "poolside",
			}),
		)
	})

	it("preserves representative legacy provider fields through proto conversion", async () => {
		const previousConfig = {
			planModeApiProvider: "anthropic",
			actModeApiProvider: "anthropic",
		}
		const setApiConfiguration = vi.fn()
		const controller = {
			getProviderConfigStore: () => makeStore(),
			stateManager: {
				getApiConfiguration: vi.fn(() => previousConfig),
				setApiConfiguration,
				getGlobalSettingsKey: vi.fn(() => "act"),
			},
			handleApiConfigurationChanged: vi.fn(),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		await updateApiConfigurationProto(
			controller,
			UpdateApiConfigurationRequest.create({
				apiConfiguration: ModelsApiConfiguration.create({
					planModeApiProvider: ApiProvider.OPENAI,
					planModeApiProviderId: "openai",
					planModeOpenAiModelId: "azure-gpt-4.1",
					planModeOpenAiModelInfo: OpenAiCompatibleModelInfo.create({
						contextWindow: 128_000,
						maxTokens: 16_384,
						supportsImages: true,
						supportsPromptCache: true,
						isR1FormatRequired: true,
					}),
					actModeApiProvider: ApiProvider.LITELLM,
					actModeApiProviderId: "litellm",
					actModeLiteLlmModelId: "litellm-model",
					actModeLiteLlmModelInfo: LiteLLMModelInfo.create({
						contextWindow: 64_000,
						maxTokens: 8_192,
						supportsPromptCache: true,
					}),
					planModeOcaModelId: "oca-plan-model",
					planModeOcaModelInfo: OcaModelInfo.create({
						contextWindow: 200_000,
						maxTokens: 32_000,
						supportsImages: true,
						supportsPromptCache: true,
					}),
					planModeSapAiCoreModelId: "sap-plan-model",
					planModeSapAiCoreDeploymentId: "sap-plan-deployment",
					actModeSapAiCoreModelId: "sap-act-model",
					actModeSapAiCoreDeploymentId: "sap-act-deployment",
					planModeAwsBedrockCustomSelected: true,
					planModeAwsBedrockCustomModelBaseId: "plan-bedrock-base",
					actModeAwsBedrockCustomSelected: true,
					actModeAwsBedrockCustomModelBaseId: "act-bedrock-base",
					planModeReasoningEffort: "high",
					actModeReasoningEffort: "medium",
					planModeOcaReasoningEffort: "low",
					actModeOcaReasoningEffort: "high",
				}),
			}),
		)

		expect(setApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				planModeApiProvider: "openai",
				planModeOpenAiModelId: "azure-gpt-4.1",
				planModeOpenAiModelInfo: expect.objectContaining({
					contextWindow: 128_000,
					maxTokens: 16_384,
					supportsImages: true,
					supportsPromptCache: true,
					isR1FormatRequired: true,
				}),
				actModeApiProvider: "litellm",
				actModeLiteLlmModelId: "litellm-model",
				actModeLiteLlmModelInfo: expect.objectContaining({
					contextWindow: 64_000,
					maxTokens: 8_192,
					supportsPromptCache: true,
				}),
				planModeOcaModelId: "oca-plan-model",
				planModeOcaModelInfo: expect.objectContaining({
					contextWindow: 200_000,
					maxTokens: 32_000,
					supportsImages: true,
					supportsPromptCache: true,
				}),
				planModeSapAiCoreModelId: "sap-plan-model",
				planModeSapAiCoreDeploymentId: "sap-plan-deployment",
				actModeSapAiCoreModelId: "sap-act-model",
				actModeSapAiCoreDeploymentId: "sap-act-deployment",
				planModeAwsBedrockCustomSelected: true,
				planModeAwsBedrockCustomModelBaseId: "plan-bedrock-base",
				actModeAwsBedrockCustomSelected: true,
				actModeAwsBedrockCustomModelBaseId: "act-bedrock-base",
				planModeReasoningEffort: "high",
				actModeReasoningEffort: "medium",
				planModeOcaReasoningEffort: "low",
				actModeOcaReasoningEffort: "high",
			}),
		)
	})

	it("preserves unsupported provider ids in storage so rollback can restore them", async () => {
		const previousConfig = {
			actModeApiProvider: "qwen-code",
			actModeApiModelId: "qwen-code-model",
		}
		const setApiConfiguration = vi.fn()
		const controller = {
			getProviderConfigStore: () => makeStore(),
			stateManager: {
				getApiConfiguration: vi.fn(() => previousConfig),
				setApiConfiguration,
				getGlobalSettingsKey: vi.fn(() => "act"),
			},
			handleApiConfigurationChanged: vi.fn(),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		await updateApiConfigurationProto(
			controller,
			UpdateApiConfigurationRequest.create({
				apiConfiguration: ModelsApiConfiguration.create({
					actModeApiProviderId: "qwen-code",
					actModeApiModelId: "qwen-code-model",
				}),
			}),
		)

		expect(setApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				actModeApiProvider: "qwen-code",
				actModeApiModelId: "qwen-code-model",
			}),
		)
	})
})
