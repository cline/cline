import { ApiConfiguration } from "@shared/api"
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
		// Core API fields
		apiProvider: config.apiProvider,
		apiModelId: config.apiModelId,
		apiKey: config.apiKey,

		// Provider-specific API keys
		clineApiKey: config.clineApiKey,
		openrouterApiKey: config.openRouterApiKey,
		anthropicBaseUrl: config.anthropicBaseUrl,
		openaiApiKey: config.openAiApiKey,
		openaiNativeApiKey: config.openAiNativeApiKey,
		geminiApiKey: config.geminiApiKey,
		deepseekApiKey: config.deepSeekApiKey,
		requestyApiKey: config.requestyApiKey,
		togetherApiKey: config.togetherApiKey,
		fireworksApiKey: config.fireworksApiKey,
		qwenApiKey: config.qwenApiKey,
		doubaoApiKey: config.doubaoApiKey,
		mistralApiKey: config.mistralApiKey,
		nebiusApiKey: config.nebiusApiKey,
		asksageApiKey: config.asksageApiKey,
		xaiApiKey: config.xaiApiKey,
		sambanovaApiKey: config.sambanovaApiKey,
		cerebrasApiKey: config.cerebrasApiKey,

		// Model IDs - each provider has its own field
		openrouterModelId: config.openRouterModelId,
		openaiModelId: config.openAiModelId,
		anthropicModelId: config.apiModelId,
		bedrockModelId: config.apiModelId,
		vertexModelId: config.apiModelId,
		geminiModelId: config.apiModelId,
		ollamaModelId: config.ollamaModelId,
		lmStudioModelId: config.lmStudioModelId,
		litellmModelId: config.liteLlmModelId,
		requestyModelId: config.requestyModelId,
		togetherModelId: config.togetherModelId,
		fireworksModelId: config.fireworksModelId,

		// AWS Bedrock fields
		awsBedrockCustomSelected: config.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: config.awsBedrockCustomModelBaseId,
		awsAccessKey: config.awsAccessKey,
		awsSecretKey: config.awsSecretKey,
		awsSessionToken: config.awsSessionToken,
		awsRegion: config.awsRegion,
		awsUseCrossRegionInference: config.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: config.awsBedrockUsePromptCache,
		awsUseProfile: config.awsUseProfile,
		awsProfile: config.awsProfile,
		awsBedrockEndpoint: config.awsBedrockEndpoint,

		// Vertex AI fields
		vertexProjectId: config.vertexProjectId,
		vertexRegion: config.vertexRegion,

		// Base URLs and endpoints
		openaiBaseUrl: config.openAiBaseUrl,
		ollamaBaseUrl: config.ollamaBaseUrl,
		lmStudioBaseUrl: config.lmStudioBaseUrl,
		geminiBaseUrl: config.geminiBaseUrl,
		litellmBaseUrl: config.liteLlmBaseUrl,
		asksageApiUrl: config.asksageApiUrl,

		// LiteLLM specific fields
		litellmApiKey: config.liteLlmApiKey,
		litellmUsePromptCache: config.liteLlmUsePromptCache,

		// Model configuration
		thinkingBudgetTokens: config.thinkingBudgetTokens ? Number(config.thinkingBudgetTokens) : undefined,
		reasoningEffort: config.reasoningEffort,
		requestTimeoutMs: config.requestTimeoutMs ? Number(config.requestTimeoutMs) : undefined,

		// Fireworks specific
		fireworksModelMaxCompletionTokens: config.fireworksModelMaxCompletionTokens
			? Number(config.fireworksModelMaxCompletionTokens)
			: undefined,
		fireworksModelMaxTokens: config.fireworksModelMaxTokens ? Number(config.fireworksModelMaxTokens) : undefined,

		// Azure specific
		azureApiVersion: config.azureApiVersion,

		// Ollama specific
		ollamaApiOptionsCtxNum: config.ollamaApiOptionsCtxNum,

		// Qwen specific
		qwenApiLine: config.qwenApiLine,

		// OpenRouter specific
		openrouterProviderSorting: config.openRouterProviderSorting,

		// Complex objects stored as JSON strings
		vscodeLmModelSelector: config.vsCodeLmModelSelector ? JSON.stringify(config.vsCodeLmModelSelector) : undefined,
		openrouterModelInfo: config.openRouterModelInfo ? JSON.stringify(config.openRouterModelInfo) : undefined,
		openaiModelInfo: config.openAiModelInfo ? JSON.stringify(config.openAiModelInfo) : undefined,
		requestyModelInfo: config.requestyModelInfo ? JSON.stringify(config.requestyModelInfo) : undefined,
		litellmModelInfo: config.liteLlmModelInfo ? JSON.stringify(config.liteLlmModelInfo) : undefined,
		openaiHeaders: config.openAiHeaders ? JSON.stringify(config.openAiHeaders) : undefined,

		// Arrays
		favoritedModelIds: config.favoritedModelIds || [],
	})
}

/**
 * Converts proto ApiConfiguration objects to domain ApiConfiguration objects
 */
export function convertProtoApiConfigurationToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	// eslint-disable-next-line eslint-rules/no-protobuf-object-literals
	const config: ApiConfiguration = {
		// Core API fields
		apiProvider: protoConfig.apiProvider as any,
		apiModelId: protoConfig.apiModelId,
		apiKey: protoConfig.apiKey,

		// Provider-specific API keys
		clineApiKey: protoConfig.clineApiKey,
		openRouterApiKey: protoConfig.openrouterApiKey,
		anthropicBaseUrl: protoConfig.anthropicBaseUrl,
		openAiApiKey: protoConfig.openaiApiKey,
		openAiNativeApiKey: protoConfig.openaiNativeApiKey,
		geminiApiKey: protoConfig.geminiApiKey,
		deepSeekApiKey: protoConfig.deepseekApiKey,
		requestyApiKey: protoConfig.requestyApiKey,
		togetherApiKey: protoConfig.togetherApiKey,
		fireworksApiKey: protoConfig.fireworksApiKey,
		qwenApiKey: protoConfig.qwenApiKey,
		doubaoApiKey: protoConfig.doubaoApiKey,
		mistralApiKey: protoConfig.mistralApiKey,
		nebiusApiKey: protoConfig.nebiusApiKey,
		asksageApiKey: protoConfig.asksageApiKey,
		xaiApiKey: protoConfig.xaiApiKey,
		sambanovaApiKey: protoConfig.sambanovaApiKey,
		cerebrasApiKey: protoConfig.cerebrasApiKey,

		// Model IDs
		openRouterModelId: protoConfig.openrouterModelId,
		openAiModelId: protoConfig.openaiModelId,
		ollamaModelId: protoConfig.ollamaModelId,
		lmStudioModelId: protoConfig.lmStudioModelId,
		liteLlmModelId: protoConfig.litellmModelId,
		requestyModelId: protoConfig.requestyModelId,
		togetherModelId: protoConfig.togetherModelId,
		fireworksModelId: protoConfig.fireworksModelId,

		// AWS Bedrock fields
		awsBedrockCustomSelected: protoConfig.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: protoConfig.awsBedrockCustomModelBaseId as any,
		awsAccessKey: protoConfig.awsAccessKey,
		awsSecretKey: protoConfig.awsSecretKey,
		awsSessionToken: protoConfig.awsSessionToken,
		awsRegion: protoConfig.awsRegion,
		awsUseCrossRegionInference: protoConfig.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: protoConfig.awsBedrockUsePromptCache,
		awsUseProfile: protoConfig.awsUseProfile,
		awsProfile: protoConfig.awsProfile,
		awsBedrockEndpoint: protoConfig.awsBedrockEndpoint,

		// Vertex AI fields
		vertexProjectId: protoConfig.vertexProjectId,
		vertexRegion: protoConfig.vertexRegion,

		// Base URLs and endpoints
		openAiBaseUrl: protoConfig.openaiBaseUrl,
		ollamaBaseUrl: protoConfig.ollamaBaseUrl,
		lmStudioBaseUrl: protoConfig.lmStudioBaseUrl,
		geminiBaseUrl: protoConfig.geminiBaseUrl,
		liteLlmBaseUrl: protoConfig.litellmBaseUrl,
		asksageApiUrl: protoConfig.asksageApiUrl,

		// LiteLLM specific fields
		liteLlmApiKey: protoConfig.litellmApiKey,
		liteLlmUsePromptCache: protoConfig.litellmUsePromptCache,

		// Model configuration
		thinkingBudgetTokens: protoConfig.thinkingBudgetTokens ? Number(protoConfig.thinkingBudgetTokens) : undefined,
		reasoningEffort: protoConfig.reasoningEffort,
		requestTimeoutMs: protoConfig.requestTimeoutMs ? Number(protoConfig.requestTimeoutMs) : undefined,

		// Fireworks specific
		fireworksModelMaxCompletionTokens: protoConfig.fireworksModelMaxCompletionTokens
			? Number(protoConfig.fireworksModelMaxCompletionTokens)
			: undefined,
		fireworksModelMaxTokens: protoConfig.fireworksModelMaxTokens ? Number(protoConfig.fireworksModelMaxTokens) : undefined,

		// Azure specific
		azureApiVersion: protoConfig.azureApiVersion,

		// Ollama specific
		ollamaApiOptionsCtxNum: protoConfig.ollamaApiOptionsCtxNum,

		// Qwen specific
		qwenApiLine: protoConfig.qwenApiLine,

		// OpenRouter specific
		openRouterProviderSorting: protoConfig.openrouterProviderSorting,

		// Arrays
		favoritedModelIds: protoConfig.favoritedModelIds || [],
	}

	// Handle complex JSON objects
	try {
		if (protoConfig.vscodeLmModelSelector) {
			config.vsCodeLmModelSelector = JSON.parse(protoConfig.vscodeLmModelSelector)
		}
		if (protoConfig.openrouterModelInfo) {
			config.openRouterModelInfo = JSON.parse(protoConfig.openrouterModelInfo)
		}
		if (protoConfig.openaiModelInfo) {
			config.openAiModelInfo = JSON.parse(protoConfig.openaiModelInfo)
		}
		if (protoConfig.requestyModelInfo) {
			config.requestyModelInfo = JSON.parse(protoConfig.requestyModelInfo)
		}
		if (protoConfig.litellmModelInfo) {
			config.liteLlmModelInfo = JSON.parse(protoConfig.litellmModelInfo)
		}
		if (protoConfig.openaiHeaders) {
			config.openAiHeaders = JSON.parse(protoConfig.openaiHeaders)
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
	// eslint-disable-next-line eslint-rules/no-protobuf-object-literals
	return {
		mode: protoChatSettings.mode === PlanActMode.PLAN ? "plan" : "act",
		preferredLanguage: protoChatSettings.preferredLanguage,
		openAIReasoningEffort: protoChatSettings.openAiReasoningEffort as "low" | "medium" | "high" | undefined,
	}
}
