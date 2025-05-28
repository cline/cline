import { ApiConfiguration as DomainApiConfiguration } from "../../api"
import { ChatSettings as DomainChatSettings, OpenAIReasoningEffort } from "../../ChatSettings"
import { TelemetrySetting as DomainTelemetrySetting } from "../../TelemetrySetting"
import { ApiConfiguration, ChatSettings, PlanActMode, TelemetrySetting } from "../../proto/state"

/**
 * Converts proto ApiConfiguration to domain ApiConfiguration
 */
export function convertProtoApiConfigurationToDomainApiConfiguration(protoConfig: ApiConfiguration): DomainApiConfiguration {
	console.log("[DEBUG] Converting proto API configuration to domain API configuration:", {
		provider: protoConfig.apiProvider,
		modelId: protoConfig.apiModelId,
		hasAnthropicApiKey: !!protoConfig.anthropicApiKey,
	})
	return {
		apiProvider: protoConfig.apiProvider as any,
		apiModelId: protoConfig.apiModelId,
		apiKey: protoConfig.anthropicApiKey, // Map anthropicApiKey to apiKey
		openAiApiKey: protoConfig.openaiApiKey,
		openRouterApiKey: protoConfig.openrouterApiKey,
		openRouterModelId: protoConfig.openrouterModelId,
		openAiModelId: protoConfig.openaiModelId,
		openAiBaseUrl: protoConfig.openAiBaseUrl,
		ollamaModelId: protoConfig.ollamaModelId,
		ollamaBaseUrl: protoConfig.ollamaBaseUrl,
		lmStudioModelId: protoConfig.lmStudioModelId,
		lmStudioBaseUrl: protoConfig.lmStudioBaseUrl,
		clineApiKey: protoConfig.clineApiKey,
		reasoningEffort: protoConfig.reasoningEffort,
		thinkingBudgetTokens: protoConfig.thinkingBudgetTokens,
		awsBedrockCustomSelected: protoConfig.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: protoConfig.awsBedrockCustomModelBaseId as any,
		liteLlmModelId: protoConfig.litellmModelId,
		liteLlmBaseUrl: protoConfig.litellmBaseUrl,
		liteLlmApiKey: protoConfig.litellmApiKey,
		requestyModelId: protoConfig.requestyModelId,
		requestyApiKey: protoConfig.requestyApiKey,
		azureApiVersion: protoConfig.azureApiVersion,
		anthropicBaseUrl: protoConfig.anthropicBaseUrl,
		openAiHeaders: protoConfig.openaiHeaders ? JSON.parse(protoConfig.openaiHeaders) : undefined,
		openAiModelInfo: protoConfig.openaiModelInfo ? JSON.parse(protoConfig.openaiModelInfo) : undefined,
		openRouterModelInfo: protoConfig.openrouterModelInfo ? JSON.parse(protoConfig.openrouterModelInfo) : undefined,
		openRouterProviderSorting: protoConfig.openrouterProviderSorting,
		vsCodeLmModelSelector: protoConfig.vscodeLmModelSelector ? JSON.parse(protoConfig.vscodeLmModelSelector) : undefined,
		ollamaApiOptionsCtxNum: protoConfig.ollamaApiOptionsCtxNum,
		fireworksModelId: protoConfig.fireworksModelId,
		fireworksModelMaxCompletionTokens: protoConfig.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: protoConfig.fireworksModelMaxTokens,
		togetherModelId: protoConfig.togetherModelId,
		togetherApiKey: protoConfig.togetherApiKey,
		qwenApiLine: protoConfig.qwenApiLine,
		qwenApiKey: protoConfig.qwenApiKey,
		doubaoApiKey: protoConfig.doubaoApiKey,
		mistralApiKey: protoConfig.mistralApiKey,
		awsRegion: protoConfig.awsRegion,
		awsUseCrossRegionInference: protoConfig.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: protoConfig.awsBedrockUsePromptCache,
		awsBedrockEndpoint: protoConfig.awsBedrockEndpoint,
		awsProfile: protoConfig.awsProfile,
		awsUseProfile: protoConfig.awsUseProfile,
		awsAccessKey: protoConfig.awsAccessKey,
		awsSecretKey: protoConfig.awsSecretKey,
		awsSessionToken: protoConfig.awsSessionToken,
		vertexProjectId: protoConfig.vertexProjectId,
		vertexRegion: protoConfig.vertexRegion,
		geminiApiKey: protoConfig.geminiApiKey,
		geminiBaseUrl: protoConfig.geminiBaseUrl,
		openAiNativeApiKey: protoConfig.openaiNativeApiKey,
		deepSeekApiKey: protoConfig.deepseekApiKey,
		asksageApiUrl: protoConfig.asksageApiUrl,
		asksageApiKey: protoConfig.asksageApiKey,
		xaiApiKey: protoConfig.xaiApiKey,
		nebiusApiKey: protoConfig.nebiusApiKey,
		sambanovaApiKey: protoConfig.sambanovaApiKey,
		cerebrasApiKey: protoConfig.cerebrasApiKey,
		liteLlmUsePromptCache: protoConfig.litellmUsePromptCache,
		liteLlmModelInfo: protoConfig.litellmModelInfo ? JSON.parse(protoConfig.litellmModelInfo) : undefined,
		requestyModelInfo: protoConfig.requestyModelInfo ? JSON.parse(protoConfig.requestyModelInfo) : undefined,
		// requestTimeoutMs is not part of the ApiConfiguration proto message,
		// it's handled separately in updateSettings.ts
	}
}

/**
 * Converts proto TelemetrySetting to domain TelemetrySetting
 */
export function convertProtoTelemetrySettingToDomainTelemetrySetting(protoSetting: TelemetrySetting): DomainTelemetrySetting {
	return protoSetting === TelemetrySetting.ENABLED ? "enabled" : "disabled"
}

/**
 * Converts proto ChatSettings to domain ChatSettings
 */
export function convertProtoChatSettingsToDomainChatSettings(protoSettings: ChatSettings): DomainChatSettings {
	return {
		mode: protoSettings.mode === PlanActMode.PLAN ? "plan" : "act",
		preferredLanguage: protoSettings.preferredLanguage,
		openAIReasoningEffort: protoSettings.openAiReasoningEffort as OpenAIReasoningEffort,
	}
}

/**
 * Converts domain ApiConfiguration to proto ApiConfiguration
 */
export function convertDomainApiConfigurationToProtoApiConfiguration(domainConfig: DomainApiConfiguration): ApiConfiguration {
	// We're using the ApiConfiguration.create factory function from the generated protobuf code
	return ApiConfiguration.create({
		apiProvider: domainConfig.apiProvider,
		apiModelId: domainConfig.apiModelId,
		anthropicApiKey: domainConfig.apiKey, // Map apiKey to anthropicApiKey
		openaiApiKey: domainConfig.openAiApiKey,
		openrouterApiKey: domainConfig.openRouterApiKey,
		openrouterModelId: domainConfig.openRouterModelId,
		openaiModelId: domainConfig.openAiModelId,
		openAiBaseUrl: domainConfig.openAiBaseUrl,
		ollamaModelId: domainConfig.ollamaModelId,
		ollamaBaseUrl: domainConfig.ollamaBaseUrl,
		lmStudioModelId: domainConfig.lmStudioModelId,
		lmStudioBaseUrl: domainConfig.lmStudioBaseUrl,
		clineApiKey: domainConfig.clineApiKey,
		reasoningEffort: domainConfig.reasoningEffort,
		thinkingBudgetTokens: domainConfig.thinkingBudgetTokens,
		awsBedrockCustomSelected: domainConfig.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: domainConfig.awsBedrockCustomModelBaseId as string,
		litellmModelId: domainConfig.liteLlmModelId,
		litellmBaseUrl: domainConfig.liteLlmBaseUrl,
		litellmApiKey: domainConfig.liteLlmApiKey,
		requestyModelId: domainConfig.requestyModelId,
		requestyApiKey: domainConfig.requestyApiKey,
		// Additional fields from state-keys.ts
		azureApiVersion: domainConfig.azureApiVersion,
		anthropicBaseUrl: domainConfig.anthropicBaseUrl,
		openaiHeaders: domainConfig.openAiHeaders ? JSON.stringify(domainConfig.openAiHeaders) : undefined,
		openaiModelInfo: domainConfig.openAiModelInfo ? JSON.stringify(domainConfig.openAiModelInfo) : undefined,
		openrouterModelInfo: domainConfig.openRouterModelInfo ? JSON.stringify(domainConfig.openRouterModelInfo) : undefined,
		openrouterProviderSorting: domainConfig.openRouterProviderSorting,
		vscodeLmModelSelector: domainConfig.vsCodeLmModelSelector
			? JSON.stringify(domainConfig.vsCodeLmModelSelector)
			: undefined,
		ollamaApiOptionsCtxNum: domainConfig.ollamaApiOptionsCtxNum,
		fireworksModelId: domainConfig.fireworksModelId,
		fireworksModelMaxCompletionTokens: domainConfig.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: domainConfig.fireworksModelMaxTokens,
		togetherModelId: domainConfig.togetherModelId,
		togetherApiKey: domainConfig.togetherApiKey,
		qwenApiLine: domainConfig.qwenApiLine,
		qwenApiKey: domainConfig.qwenApiKey,
		doubaoApiKey: domainConfig.doubaoApiKey,
		mistralApiKey: domainConfig.mistralApiKey,
		awsRegion: domainConfig.awsRegion,
		awsUseCrossRegionInference: domainConfig.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: domainConfig.awsBedrockUsePromptCache,
		awsBedrockEndpoint: domainConfig.awsBedrockEndpoint,
		awsProfile: domainConfig.awsProfile,
		awsUseProfile: domainConfig.awsUseProfile,
		awsAccessKey: domainConfig.awsAccessKey,
		awsSecretKey: domainConfig.awsSecretKey,
		awsSessionToken: domainConfig.awsSessionToken,
		vertexProjectId: domainConfig.vertexProjectId,
		vertexRegion: domainConfig.vertexRegion,
		geminiApiKey: domainConfig.geminiApiKey,
		geminiBaseUrl: domainConfig.geminiBaseUrl,
		openaiNativeApiKey: domainConfig.openAiNativeApiKey,
		deepseekApiKey: domainConfig.deepSeekApiKey,
		asksageApiUrl: domainConfig.asksageApiUrl,
		asksageApiKey: domainConfig.asksageApiKey,
		xaiApiKey: domainConfig.xaiApiKey,
		nebiusApiKey: domainConfig.nebiusApiKey,
		sambanovaApiKey: domainConfig.sambanovaApiKey,
		cerebrasApiKey: domainConfig.cerebrasApiKey,
		litellmUsePromptCache: domainConfig.liteLlmUsePromptCache,
		litellmModelInfo: domainConfig.liteLlmModelInfo ? JSON.stringify(domainConfig.liteLlmModelInfo) : undefined,
		requestyModelInfo: domainConfig.requestyModelInfo ? JSON.stringify(domainConfig.requestyModelInfo) : undefined,
		//requestTimeoutMs: domainConfig.requestTimeoutMs,
	})
}

/**
 * Converts domain TelemetrySetting to proto TelemetrySetting
 */
export function convertDomainTelemetrySettingToProtoTelemetrySetting(domainSetting: DomainTelemetrySetting): TelemetrySetting {
	return domainSetting === "enabled" ? TelemetrySetting.ENABLED : TelemetrySetting.DISABLED
}

/**
 * Converts domain ChatSettings to proto ChatSettings
 */
export function convertDomainChatSettingsToProtoChatSettings(domainSettings: DomainChatSettings): ChatSettings {
	return ChatSettings.create({
		mode: domainSettings.mode === "plan" ? PlanActMode.PLAN : PlanActMode.ACT,
		preferredLanguage: domainSettings.preferredLanguage,
		openAiReasoningEffort: domainSettings.openAIReasoningEffort,
	})
}
