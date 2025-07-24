import { ApiConfiguration, ApiProvider, BedrockModelId } from "@shared/api"
import { ChatSettings } from "@shared/ChatSettings"
import {
	ApiConfiguration as ProtoApiConfiguration,
	ChatSettings as ProtoChatSettings,
	PlanActMode,
} from "../../../shared/proto/state"

/**
 * Converts domain ApiConfiguration objects to proto ApiConfiguration objects
 */
export function convertApiConfigurationToProtoApiConfiguration(config: ApiConfiguration): ProtoApiConfiguration {
	return ProtoApiConfiguration.create({
		// Global configuration fields (not mode-specific)
		apiKey: config.apiKey,
		clineAccountId: config.clineAccountId,
		taskId: config.taskId,
		liteLlmBaseUrl: config.liteLlmBaseUrl,
		liteLlmApiKey: config.liteLlmApiKey,
		liteLlmUsePromptCache: config.liteLlmUsePromptCache,
		openaiHeaders: config.openAiHeaders ? JSON.stringify(config.openAiHeaders) : undefined,
		anthropicBaseUrl: config.anthropicBaseUrl,
		openrouterApiKey: config.openRouterApiKey,
		openrouterProviderSorting: config.openRouterProviderSorting,
		awsAccessKey: config.awsAccessKey,
		awsSecretKey: config.awsSecretKey,
		awsSessionToken: config.awsSessionToken,
		awsRegion: config.awsRegion,
		awsUseCrossRegionInference: config.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: config.awsBedrockUsePromptCache,
		awsUseProfile: config.awsUseProfile,
		awsAuthentication: config.awsAuthentication,
		awsProfile: config.awsProfile,
		awsBedrockApiKey: config.awsBedrockApiKey,
		awsBedrockEndpoint: config.awsBedrockEndpoint,
		claudeCodePath: config.claudeCodePath,
		vertexProjectId: config.vertexProjectId,
		vertexRegion: config.vertexRegion,
		openaiBaseUrl: config.openAiBaseUrl,
		openaiApiKey: config.openAiApiKey,
		ollamaBaseUrl: config.ollamaBaseUrl,
		ollamaApiOptionsCtxNum: config.ollamaApiOptionsCtxNum,
		lmStudioBaseUrl: config.lmStudioBaseUrl,
		geminiApiKey: config.geminiApiKey,
		geminiBaseUrl: config.geminiBaseUrl,
		openaiNativeApiKey: config.openAiNativeApiKey,
		deepSeekApiKey: config.deepSeekApiKey,
		requestyApiKey: config.requestyApiKey,
		togetherApiKey: config.togetherApiKey,
		fireworksApiKey: config.fireworksApiKey,
		fireworksModelMaxCompletionTokens: config.fireworksModelMaxCompletionTokens
			? Number(config.fireworksModelMaxCompletionTokens)
			: undefined,
		fireworksModelMaxTokens: config.fireworksModelMaxTokens ? Number(config.fireworksModelMaxTokens) : undefined,
		qwenApiKey: config.qwenApiKey,
		doubaoApiKey: config.doubaoApiKey,
		mistralApiKey: config.mistralApiKey,
		moonshotApiKey: config.moonshotApiKey,
		azureApiVersion: config.azureApiVersion,
		qwenApiLine: config.qwenApiLine,
		nebiusApiKey: config.nebiusApiKey,
		asksageApiUrl: config.asksageApiUrl,
		asksageApiKey: config.asksageApiKey,
		xaiApiKey: config.xaiApiKey,
		sambanovaApiKey: config.sambanovaApiKey,
		cerebrasApiKey: config.cerebrasApiKey,
		requestTimeoutMs: config.requestTimeoutMs ? Number(config.requestTimeoutMs) : undefined,
		sapAiCoreClientId: config.sapAiCoreClientId,
		sapAiCoreClientSecret: config.sapAiCoreClientSecret,
		sapAiResourceGroup: config.sapAiResourceGroup,
		sapAiCoreTokenUrl: config.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: config.sapAiCoreBaseUrl,

		// Plan mode configurations
		planModeApiProvider: config.planModeApiProvider,
		planModeApiModelId: config.planModeApiModelId,
		planModeThinkingBudgetTokens: config.planModeThinkingBudgetTokens
			? Number(config.planModeThinkingBudgetTokens)
			: undefined,
		planModeReasoningEffort: config.planModeReasoningEffort,
		planModeVscodeLmModelSelector: config.planModeVsCodeLmModelSelector
			? JSON.stringify(config.planModeVsCodeLmModelSelector)
			: undefined,
		planModeAwsBedrockCustomSelected: config.planModeAwsBedrockCustomSelected,
		planModeAwsBedrockCustomModelBaseId: config.planModeAwsBedrockCustomModelBaseId,
		planModeOpenrouterModelId: config.planModeOpenRouterModelId,
		planModeOpenrouterModelInfo: config.planModeOpenRouterModelInfo
			? JSON.stringify(config.planModeOpenRouterModelInfo)
			: undefined,
		planModeOpenaiModelId: config.planModeOpenAiModelId,
		planModeOpenaiModelInfo: config.planModeOpenAiModelInfo ? JSON.stringify(config.planModeOpenAiModelInfo) : undefined,
		planModeOllamaModelId: config.planModeOllamaModelId,
		planModeLmStudioModelId: config.planModeLmStudioModelId,
		planModeLiteLlmModelId: config.planModeLiteLlmModelId,
		planModeLiteLlmModelInfo: config.planModeLiteLlmModelInfo ? JSON.stringify(config.planModeLiteLlmModelInfo) : undefined,
		planModeRequestyModelId: config.planModeRequestyModelId,
		planModeRequestyModelInfo: config.planModeRequestyModelInfo
			? JSON.stringify(config.planModeRequestyModelInfo)
			: undefined,
		planModeTogetherModelId: config.planModeTogetherModelId,
		planModeFireworksModelId: config.planModeFireworksModelId,
		planModeSapAiCoreModelId: config.planModeSapAiCoreModelId,

		// Act mode configurations
		actModeApiProvider: config.actModeApiProvider,
		actModeApiModelId: config.actModeApiModelId,
		actModeThinkingBudgetTokens: config.actModeThinkingBudgetTokens ? Number(config.actModeThinkingBudgetTokens) : undefined,
		actModeReasoningEffort: config.actModeReasoningEffort,
		actModeVscodeLmModelSelector: config.actModeVsCodeLmModelSelector
			? JSON.stringify(config.actModeVsCodeLmModelSelector)
			: undefined,
		actModeAwsBedrockCustomSelected: config.actModeAwsBedrockCustomSelected,
		actModeAwsBedrockCustomModelBaseId: config.actModeAwsBedrockCustomModelBaseId,
		actModeOpenrouterModelId: config.actModeOpenRouterModelId,
		actModeOpenrouterModelInfo: config.actModeOpenRouterModelInfo
			? JSON.stringify(config.actModeOpenRouterModelInfo)
			: undefined,
		actModeOpenaiModelId: config.actModeOpenAiModelId,
		actModeOpenaiModelInfo: config.actModeOpenAiModelInfo ? JSON.stringify(config.actModeOpenAiModelInfo) : undefined,
		actModeOllamaModelId: config.actModeOllamaModelId,
		actModeLmStudioModelId: config.actModeLmStudioModelId,
		actModeLiteLlmModelId: config.actModeLiteLlmModelId,
		actModeLiteLlmModelInfo: config.actModeLiteLlmModelInfo ? JSON.stringify(config.actModeLiteLlmModelInfo) : undefined,
		actModeRequestyModelId: config.actModeRequestyModelId,
		actModeRequestyModelInfo: config.actModeRequestyModelInfo ? JSON.stringify(config.actModeRequestyModelInfo) : undefined,
		actModeTogetherModelId: config.actModeTogetherModelId,
		actModeFireworksModelId: config.actModeFireworksModelId,
		actModeSapAiCoreModelId: config.actModeSapAiCoreModelId,

		// Favorited model IDs
		favoritedModelIds: config.favoritedModelIds || [],
	})
}

/**
 * Converts proto ApiConfiguration objects to domain ApiConfiguration objects
 */
export function convertProtoApiConfigurationToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	const config: ApiConfiguration = {
		// Global configuration fields (not mode-specific)
		apiKey: protoConfig.apiKey,
		clineAccountId: protoConfig.clineAccountId,
		taskId: protoConfig.taskId,
		liteLlmBaseUrl: protoConfig.liteLlmBaseUrl,
		liteLlmApiKey: protoConfig.liteLlmApiKey,
		liteLlmUsePromptCache: protoConfig.liteLlmUsePromptCache,
		anthropicBaseUrl: protoConfig.anthropicBaseUrl,
		openRouterApiKey: protoConfig.openrouterApiKey,
		openRouterProviderSorting: protoConfig.openrouterProviderSorting,
		awsAccessKey: protoConfig.awsAccessKey,
		awsSecretKey: protoConfig.awsSecretKey,
		awsSessionToken: protoConfig.awsSessionToken,
		awsRegion: protoConfig.awsRegion,
		awsUseCrossRegionInference: protoConfig.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: protoConfig.awsBedrockUsePromptCache,
		awsUseProfile: protoConfig.awsUseProfile,
		awsProfile: protoConfig.awsProfile,
		awsAuthentication: protoConfig.awsAuthentication,
		awsBedrockApiKey: protoConfig.awsBedrockApiKey,
		awsBedrockEndpoint: protoConfig.awsBedrockEndpoint,
		claudeCodePath: protoConfig.claudeCodePath,
		vertexProjectId: protoConfig.vertexProjectId,
		vertexRegion: protoConfig.vertexRegion,
		openAiBaseUrl: protoConfig.openaiBaseUrl,
		openAiApiKey: protoConfig.openaiApiKey,
		ollamaBaseUrl: protoConfig.ollamaBaseUrl,
		ollamaApiOptionsCtxNum: protoConfig.ollamaApiOptionsCtxNum,
		lmStudioBaseUrl: protoConfig.lmStudioBaseUrl,
		geminiApiKey: protoConfig.geminiApiKey,
		geminiBaseUrl: protoConfig.geminiBaseUrl,
		openAiNativeApiKey: protoConfig.openaiNativeApiKey,
		deepSeekApiKey: protoConfig.deepSeekApiKey,
		requestyApiKey: protoConfig.requestyApiKey,
		togetherApiKey: protoConfig.togetherApiKey,
		fireworksApiKey: protoConfig.fireworksApiKey,
		fireworksModelMaxCompletionTokens: protoConfig.fireworksModelMaxCompletionTokens
			? Number(protoConfig.fireworksModelMaxCompletionTokens)
			: undefined,
		fireworksModelMaxTokens: protoConfig.fireworksModelMaxTokens ? Number(protoConfig.fireworksModelMaxTokens) : undefined,
		qwenApiKey: protoConfig.qwenApiKey,
		doubaoApiKey: protoConfig.doubaoApiKey,
		mistralApiKey: protoConfig.mistralApiKey,
		moonshotApiKey: protoConfig.moonshotApiKey,
		azureApiVersion: protoConfig.azureApiVersion,
		qwenApiLine: protoConfig.qwenApiLine,
		nebiusApiKey: protoConfig.nebiusApiKey,
		asksageApiUrl: protoConfig.asksageApiUrl,
		asksageApiKey: protoConfig.asksageApiKey,
		xaiApiKey: protoConfig.xaiApiKey,
		sambanovaApiKey: protoConfig.sambanovaApiKey,
		cerebrasApiKey: protoConfig.cerebrasApiKey,
		requestTimeoutMs: protoConfig.requestTimeoutMs ? Number(protoConfig.requestTimeoutMs) : undefined,
		sapAiCoreClientId: protoConfig.sapAiCoreClientId,
		sapAiCoreClientSecret: protoConfig.sapAiCoreClientSecret,
		sapAiResourceGroup: protoConfig.sapAiResourceGroup,
		sapAiCoreTokenUrl: protoConfig.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: protoConfig.sapAiCoreBaseUrl,

		// Plan mode configurations
		planModeApiProvider: protoConfig.planModeApiProvider as ApiProvider,
		planModeApiModelId: protoConfig.planModeApiModelId,
		planModeThinkingBudgetTokens: protoConfig.planModeThinkingBudgetTokens
			? Number(protoConfig.planModeThinkingBudgetTokens)
			: undefined,
		planModeReasoningEffort: protoConfig.planModeReasoningEffort,
		planModeAwsBedrockCustomSelected: protoConfig.planModeAwsBedrockCustomSelected,
		planModeAwsBedrockCustomModelBaseId: protoConfig.planModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		planModeOpenRouterModelId: protoConfig.planModeOpenrouterModelId,
		planModeOpenAiModelId: protoConfig.planModeOpenaiModelId,
		planModeOllamaModelId: protoConfig.planModeOllamaModelId,
		planModeLmStudioModelId: protoConfig.planModeLmStudioModelId,
		planModeLiteLlmModelId: protoConfig.planModeLiteLlmModelId,
		planModeRequestyModelId: protoConfig.planModeRequestyModelId,
		planModeTogetherModelId: protoConfig.planModeTogetherModelId,
		planModeFireworksModelId: protoConfig.planModeFireworksModelId,
		planModeSapAiCoreModelId: protoConfig.planModeSapAiCoreModelId,

		// Act mode configurations
		actModeApiProvider: protoConfig.actModeApiProvider as ApiProvider,
		actModeApiModelId: protoConfig.actModeApiModelId,
		actModeThinkingBudgetTokens: protoConfig.actModeThinkingBudgetTokens
			? Number(protoConfig.actModeThinkingBudgetTokens)
			: undefined,
		actModeReasoningEffort: protoConfig.actModeReasoningEffort,
		actModeAwsBedrockCustomSelected: protoConfig.actModeAwsBedrockCustomSelected,
		actModeAwsBedrockCustomModelBaseId: protoConfig.actModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		actModeOpenRouterModelId: protoConfig.actModeOpenrouterModelId,
		actModeOpenAiModelId: protoConfig.actModeOpenaiModelId,
		actModeOllamaModelId: protoConfig.actModeOllamaModelId,
		actModeLmStudioModelId: protoConfig.actModeLmStudioModelId,
		actModeLiteLlmModelId: protoConfig.actModeLiteLlmModelId,
		actModeRequestyModelId: protoConfig.actModeRequestyModelId,
		actModeTogetherModelId: protoConfig.actModeTogetherModelId,
		actModeFireworksModelId: protoConfig.actModeFireworksModelId,
		actModeSapAiCoreModelId: protoConfig.actModeSapAiCoreModelId,

		// Favorited model IDs
		favoritedModelIds: protoConfig.favoritedModelIds || [],
	}

	// Handle complex JSON objects
	try {
		if (protoConfig.openaiHeaders) {
			config.openAiHeaders = JSON.parse(protoConfig.openaiHeaders)
		}
		if (protoConfig.planModeVscodeLmModelSelector) {
			config.planModeVsCodeLmModelSelector = JSON.parse(protoConfig.planModeVscodeLmModelSelector)
		}
		if (protoConfig.planModeOpenrouterModelInfo) {
			config.planModeOpenRouterModelInfo = JSON.parse(protoConfig.planModeOpenrouterModelInfo)
		}
		if (protoConfig.planModeOpenaiModelInfo) {
			config.planModeOpenAiModelInfo = JSON.parse(protoConfig.planModeOpenaiModelInfo)
		}
		if (protoConfig.planModeLiteLlmModelInfo) {
			config.planModeLiteLlmModelInfo = JSON.parse(protoConfig.planModeLiteLlmModelInfo)
		}
		if (protoConfig.planModeRequestyModelInfo) {
			config.planModeRequestyModelInfo = JSON.parse(protoConfig.planModeRequestyModelInfo)
		}
		if (protoConfig.actModeVscodeLmModelSelector) {
			config.actModeVsCodeLmModelSelector = JSON.parse(protoConfig.actModeVscodeLmModelSelector)
		}
		if (protoConfig.actModeOpenrouterModelInfo) {
			config.actModeOpenRouterModelInfo = JSON.parse(protoConfig.actModeOpenrouterModelInfo)
		}
		if (protoConfig.actModeOpenaiModelInfo) {
			config.actModeOpenAiModelInfo = JSON.parse(protoConfig.actModeOpenaiModelInfo)
		}
		if (protoConfig.actModeLiteLlmModelInfo) {
			config.actModeLiteLlmModelInfo = JSON.parse(protoConfig.actModeLiteLlmModelInfo)
		}
		if (protoConfig.actModeRequestyModelInfo) {
			config.actModeRequestyModelInfo = JSON.parse(protoConfig.actModeRequestyModelInfo)
		}
	} catch (error) {
		console.error("Failed to parse complex JSON objects in API configuration:", error)
	}

	return config
}

/**
 * Converts domain ChatSettings objects to proto ChatSettings objects
 */
export function convertChatSettingsToProtoChatSettings(chatSettings: ChatSettings): ProtoChatSettings {
	return ProtoChatSettings.create({
		mode: chatSettings.mode === "plan" ? PlanActMode.PLAN : PlanActMode.ACT,
		preferredLanguage: chatSettings.preferredLanguage,
		openAiReasoningEffort: chatSettings.openAIReasoningEffort,
	})
}

/**
 * Converts proto ChatSettings objects to domain ChatSettings objects
 */
export function convertProtoChatSettingsToChatSettings(protoChatSettings: ProtoChatSettings): ChatSettings {
	return {
		mode: protoChatSettings.mode === PlanActMode.PLAN ? "plan" : "act",
		preferredLanguage: protoChatSettings.preferredLanguage,
		openAIReasoningEffort: protoChatSettings.openAiReasoningEffort as "low" | "medium" | "high" | undefined,
	}
}
