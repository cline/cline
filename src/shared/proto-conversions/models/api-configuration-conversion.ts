import {
	ApiConfiguration,
	ApiProvider,
	BedrockModelId,
	ModelInfo,
	OpenAiCompatibleModelInfo as AppOpenAiCompatibleModelInfo,
	LiteLLMModelInfo as AppLiteLLMModelInfo,
} from "../../api"
import {
	ModelsApiConfiguration as ProtoApiConfiguration,
	ApiProvider as ProtoApiProvider,
	LiteLLMModelInfo,
	OpenAiCompatibleModelInfo,
	OpenRouterModelInfo,
	ThinkingConfig,
} from "@shared/proto/cline/models"

// Convert application ThinkingConfig to proto ThinkingConfig
function convertThinkingConfigToProto(config: ModelInfo["thinkingConfig"]): ThinkingConfig | undefined {
	if (!config) {
		return undefined
	}

	return {
		maxBudget: config.maxBudget,
		outputPrice: config.outputPrice,
		outputPriceTiers: config.outputPriceTiers || [], // Provide empty array if undefined
	}
}

// Convert proto ThinkingConfig to application ThinkingConfig
function convertProtoToThinkingConfig(config: ThinkingConfig | undefined): ModelInfo["thinkingConfig"] | undefined {
	if (!config) {
		return undefined
	}

	return {
		maxBudget: config.maxBudget,
		outputPrice: config.outputPrice,
		outputPriceTiers: config.outputPriceTiers.length > 0 ? config.outputPriceTiers : undefined,
	}
}

// Convert application ModelInfo to proto OpenRouterModelInfo
function convertModelInfoToProtoOpenRouter(info: ModelInfo | undefined): OpenRouterModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache ?? false,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		thinkingConfig: convertThinkingConfigToProto(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		tiers: info.tiers || [],
	}
}

// Convert proto OpenRouterModelInfo to application ModelInfo
function convertProtoToModelInfo(info: OpenRouterModelInfo | undefined): ModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		thinkingConfig: convertProtoToThinkingConfig(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		tiers: info.tiers.length > 0 ? info.tiers : undefined,
	}
}

// Convert application LiteLLMModelInfo to proto LiteLLMModelInfo
function convertLiteLLMModelInfoToProto(info: AppLiteLLMModelInfo | undefined): LiteLLMModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache ?? false,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		thinkingConfig: convertThinkingConfigToProto(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		tiers: info.tiers || [],
		temperature: info.temperature,
	}
}

// Convert proto LiteLLMModelInfo to application LiteLLMModelInfo
function convertProtoToLiteLLMModelInfo(info: LiteLLMModelInfo | undefined): AppLiteLLMModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		thinkingConfig: convertProtoToThinkingConfig(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		tiers: info.tiers.length > 0 ? info.tiers : undefined,
		temperature: info.temperature,
	}
}

// Convert application OpenAiCompatibleModelInfo to proto OpenAiCompatibleModelInfo
function convertOpenAiCompatibleModelInfoToProto(
	info: AppOpenAiCompatibleModelInfo | undefined,
): OpenAiCompatibleModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache ?? false,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		thinkingConfig: convertThinkingConfigToProto(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		tiers: info.tiers || [],
		temperature: info.temperature,
		isR1FormatRequired: info.isR1FormatRequired,
	}
}

// Convert proto OpenAiCompatibleModelInfo to application OpenAiCompatibleModelInfo
function convertProtoToOpenAiCompatibleModelInfo(
	info: OpenAiCompatibleModelInfo | undefined,
): AppOpenAiCompatibleModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		thinkingConfig: convertProtoToThinkingConfig(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		tiers: info.tiers.length > 0 ? info.tiers : undefined,
		temperature: info.temperature,
		isR1FormatRequired: info.isR1FormatRequired,
	}
}

// Convert application ApiProvider to proto ApiProvider
function convertApiProviderToProto(provider: string | undefined): ProtoApiProvider {
	switch (provider) {
		case "anthropic":
			return ProtoApiProvider.ANTHROPIC
		case "openrouter":
			return ProtoApiProvider.OPENROUTER
		case "bedrock":
			return ProtoApiProvider.BEDROCK
		case "vertex":
			return ProtoApiProvider.VERTEX
		case "openai":
			return ProtoApiProvider.OPENAI
		case "ollama":
			return ProtoApiProvider.OLLAMA
		case "lmstudio":
			return ProtoApiProvider.LMSTUDIO
		case "gemini":
			return ProtoApiProvider.GEMINI
		case "openai-native":
			return ProtoApiProvider.OPENAI_NATIVE
		case "requesty":
			return ProtoApiProvider.REQUESTY
		case "together":
			return ProtoApiProvider.TOGETHER
		case "deepseek":
			return ProtoApiProvider.DEEPSEEK
		case "qwen":
			return ProtoApiProvider.QWEN
		case "doubao":
			return ProtoApiProvider.DOUBAO
		case "mistral":
			return ProtoApiProvider.MISTRAL
		case "vscode-lm":
			return ProtoApiProvider.VSCODE_LM
		case "cline":
			return ProtoApiProvider.CLINE
		case "litellm":
			return ProtoApiProvider.LITELLM
		case "moonshot":
			return ProtoApiProvider.MOONSHOT
		case "huggingface":
			return ProtoApiProvider.HUGGINGFACE
		case "nebius":
			return ProtoApiProvider.NEBIUS
		case "fireworks":
			return ProtoApiProvider.FIREWORKS
		case "asksage":
			return ProtoApiProvider.ASKSAGE
		case "xai":
			return ProtoApiProvider.XAI
		case "sambanova":
			return ProtoApiProvider.SAMBANOVA
		case "cerebras":
			return ProtoApiProvider.CEREBRAS
		case "groq":
			return ProtoApiProvider.GROQ
		case "sapaicore":
			return ProtoApiProvider.SAPAICORE
		case "claude-code":
			return ProtoApiProvider.CLAUDE_CODE
		default:
			return ProtoApiProvider.ANTHROPIC
	}
}

// Convert proto ApiProvider to application ApiProvider
function convertProtoToApiProvider(provider: ProtoApiProvider): ApiProvider {
	switch (provider) {
		case ProtoApiProvider.ANTHROPIC:
			return "anthropic"
		case ProtoApiProvider.OPENROUTER:
			return "openrouter"
		case ProtoApiProvider.BEDROCK:
			return "bedrock"
		case ProtoApiProvider.VERTEX:
			return "vertex"
		case ProtoApiProvider.OPENAI:
			return "openai"
		case ProtoApiProvider.OLLAMA:
			return "ollama"
		case ProtoApiProvider.LMSTUDIO:
			return "lmstudio"
		case ProtoApiProvider.GEMINI:
			return "gemini"
		case ProtoApiProvider.OPENAI_NATIVE:
			return "openai-native"
		case ProtoApiProvider.REQUESTY:
			return "requesty"
		case ProtoApiProvider.TOGETHER:
			return "together"
		case ProtoApiProvider.DEEPSEEK:
			return "deepseek"
		case ProtoApiProvider.QWEN:
			return "qwen"
		case ProtoApiProvider.DOUBAO:
			return "doubao"
		case ProtoApiProvider.MISTRAL:
			return "mistral"
		case ProtoApiProvider.VSCODE_LM:
			return "vscode-lm"
		case ProtoApiProvider.CLINE:
			return "cline"
		case ProtoApiProvider.LITELLM:
			return "litellm"
		case ProtoApiProvider.MOONSHOT:
			return "moonshot"
		case ProtoApiProvider.HUGGINGFACE:
			return "huggingface"
		case ProtoApiProvider.NEBIUS:
			return "nebius"
		case ProtoApiProvider.FIREWORKS:
			return "fireworks"
		case ProtoApiProvider.ASKSAGE:
			return "asksage"
		case ProtoApiProvider.XAI:
			return "xai"
		case ProtoApiProvider.SAMBANOVA:
			return "sambanova"
		case ProtoApiProvider.CEREBRAS:
			return "cerebras"
		case ProtoApiProvider.GROQ:
			return "groq"
		case ProtoApiProvider.SAPAICORE:
			return "sapaicore"
		case ProtoApiProvider.CLAUDE_CODE:
			return "claude-code"
		default:
			return "anthropic"
	}
}

// Converts application ApiConfiguration to proto ApiConfiguration
export function convertApiConfigurationToProto(config: ApiConfiguration): ProtoApiConfiguration {
	return {
		// Global configuration fields
		apiKey: config.apiKey,
		clineAccountId: config.clineAccountId,
		taskId: config.taskId,
		liteLlmBaseUrl: config.liteLlmBaseUrl,
		liteLlmApiKey: config.liteLlmApiKey,
		liteLlmUsePromptCache: config.liteLlmUsePromptCache,
		openAiHeaders: config.openAiHeaders || {},
		anthropicBaseUrl: config.anthropicBaseUrl,
		openRouterApiKey: config.openRouterApiKey,
		openRouterProviderSorting: config.openRouterProviderSorting,
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
		openAiBaseUrl: config.openAiBaseUrl,
		openAiApiKey: config.openAiApiKey,
		ollamaBaseUrl: config.ollamaBaseUrl,
		ollamaApiOptionsCtxNum: config.ollamaApiOptionsCtxNum,
		lmStudioBaseUrl: config.lmStudioBaseUrl,
		geminiApiKey: config.geminiApiKey,
		geminiBaseUrl: config.geminiBaseUrl,
		openAiNativeApiKey: config.openAiNativeApiKey,
		deepSeekApiKey: config.deepSeekApiKey,
		requestyApiKey: config.requestyApiKey,
		togetherApiKey: config.togetherApiKey,
		fireworksApiKey: config.fireworksApiKey,
		fireworksModelMaxCompletionTokens: config.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: config.fireworksModelMaxTokens,
		qwenApiKey: config.qwenApiKey,
		doubaoApiKey: config.doubaoApiKey,
		mistralApiKey: config.mistralApiKey,
		azureApiVersion: config.azureApiVersion,
		qwenApiLine: config.qwenApiLine,
		moonshotApiLine: config.moonshotApiLine,
		moonshotApiKey: config.moonshotApiKey,
		huggingFaceApiKey: config.huggingFaceApiKey,
		nebiusApiKey: config.nebiusApiKey,
		asksageApiUrl: config.asksageApiUrl,
		asksageApiKey: config.asksageApiKey,
		xaiApiKey: config.xaiApiKey,
		sambanovaApiKey: config.sambanovaApiKey,
		cerebrasApiKey: config.cerebrasApiKey,
		groqApiKey: config.groqApiKey,
		requestTimeoutMs: config.requestTimeoutMs,
		sapAiCoreClientId: config.sapAiCoreClientId,
		sapAiCoreClientSecret: config.sapAiCoreClientSecret,
		sapAiResourceGroup: config.sapAiResourceGroup,
		sapAiCoreTokenUrl: config.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: config.sapAiCoreBaseUrl,

		// Plan mode configurations
		planModeApiProvider: config.planModeApiProvider ? convertApiProviderToProto(config.planModeApiProvider) : undefined,
		planModeApiModelId: config.planModeApiModelId,
		planModeThinkingBudgetTokens: config.planModeThinkingBudgetTokens,
		planModeReasoningEffort: config.planModeReasoningEffort,
		planModeVsCodeLmModelSelector: config.planModeVsCodeLmModelSelector,
		planModeAwsBedrockCustomSelected: config.planModeAwsBedrockCustomSelected,
		planModeAwsBedrockCustomModelBaseId: config.planModeAwsBedrockCustomModelBaseId as string | undefined,
		planModeOpenRouterModelId: config.planModeOpenRouterModelId,
		planModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.planModeOpenRouterModelInfo),
		planModeOpenAiModelId: config.planModeOpenAiModelId,
		planModeOpenAiModelInfo: convertOpenAiCompatibleModelInfoToProto(config.planModeOpenAiModelInfo),
		planModeOllamaModelId: config.planModeOllamaModelId,
		planModeLmStudioModelId: config.planModeLmStudioModelId,
		planModeLiteLlmModelId: config.planModeLiteLlmModelId,
		planModeLiteLlmModelInfo: convertLiteLLMModelInfoToProto(config.planModeLiteLlmModelInfo),
		planModeRequestyModelId: config.planModeRequestyModelId,
		planModeRequestyModelInfo: convertModelInfoToProtoOpenRouter(config.planModeRequestyModelInfo),
		planModeTogetherModelId: config.planModeTogetherModelId,
		planModeFireworksModelId: config.planModeFireworksModelId,
		planModeGroqModelId: config.planModeGroqModelId,
		planModeGroqModelInfo: convertModelInfoToProtoOpenRouter(config.planModeGroqModelInfo),
		planModeHuggingFaceModelId: config.planModeHuggingFaceModelId,
		planModeHuggingFaceModelInfo: convertModelInfoToProtoOpenRouter(config.planModeHuggingFaceModelInfo),
		planModeSapAiCoreModelId: config.planModeSapAiCoreModelId,

		// Act mode configurations
		actModeApiProvider: config.actModeApiProvider ? convertApiProviderToProto(config.actModeApiProvider) : undefined,
		actModeApiModelId: config.actModeApiModelId,
		actModeThinkingBudgetTokens: config.actModeThinkingBudgetTokens,
		actModeReasoningEffort: config.actModeReasoningEffort,
		actModeVsCodeLmModelSelector: config.actModeVsCodeLmModelSelector,
		actModeAwsBedrockCustomSelected: config.actModeAwsBedrockCustomSelected,
		actModeAwsBedrockCustomModelBaseId: config.actModeAwsBedrockCustomModelBaseId as string | undefined,
		actModeOpenRouterModelId: config.actModeOpenRouterModelId,
		actModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.actModeOpenRouterModelInfo),
		actModeOpenAiModelId: config.actModeOpenAiModelId,
		actModeOpenAiModelInfo: convertOpenAiCompatibleModelInfoToProto(config.actModeOpenAiModelInfo),
		actModeOllamaModelId: config.actModeOllamaModelId,
		actModeLmStudioModelId: config.actModeLmStudioModelId,
		actModeLiteLlmModelId: config.actModeLiteLlmModelId,
		actModeLiteLlmModelInfo: convertLiteLLMModelInfoToProto(config.actModeLiteLlmModelInfo),
		actModeRequestyModelId: config.actModeRequestyModelId,
		actModeRequestyModelInfo: convertModelInfoToProtoOpenRouter(config.actModeRequestyModelInfo),
		actModeTogetherModelId: config.actModeTogetherModelId,
		actModeFireworksModelId: config.actModeFireworksModelId,
		actModeGroqModelId: config.actModeGroqModelId,
		actModeGroqModelInfo: convertModelInfoToProtoOpenRouter(config.actModeGroqModelInfo),
		actModeHuggingFaceModelId: config.actModeHuggingFaceModelId,
		actModeHuggingFaceModelInfo: convertModelInfoToProtoOpenRouter(config.actModeHuggingFaceModelInfo),
		actModeSapAiCoreModelId: config.actModeSapAiCoreModelId,

		// Favorited model IDs
		favoritedModelIds: config.favoritedModelIds || [],
	}
}

// Converts proto ApiConfiguration to application ApiConfiguration
export function convertProtoToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	return {
		// Global configuration fields
		apiKey: protoConfig.apiKey,
		clineAccountId: protoConfig.clineAccountId,
		taskId: protoConfig.taskId,
		liteLlmBaseUrl: protoConfig.liteLlmBaseUrl,
		liteLlmApiKey: protoConfig.liteLlmApiKey,
		liteLlmUsePromptCache: protoConfig.liteLlmUsePromptCache,
		openAiHeaders: Object.keys(protoConfig.openAiHeaders || {}).length > 0 ? protoConfig.openAiHeaders : undefined,
		anthropicBaseUrl: protoConfig.anthropicBaseUrl,
		openRouterApiKey: protoConfig.openRouterApiKey,
		openRouterProviderSorting: protoConfig.openRouterProviderSorting,
		awsAccessKey: protoConfig.awsAccessKey,
		awsSecretKey: protoConfig.awsSecretKey,
		awsSessionToken: protoConfig.awsSessionToken,
		awsRegion: protoConfig.awsRegion,
		awsUseCrossRegionInference: protoConfig.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: protoConfig.awsBedrockUsePromptCache,
		awsUseProfile: protoConfig.awsUseProfile,
		awsAuthentication: protoConfig.awsAuthentication,
		awsProfile: protoConfig.awsProfile,
		awsBedrockApiKey: protoConfig.awsBedrockApiKey,
		awsBedrockEndpoint: protoConfig.awsBedrockEndpoint,
		claudeCodePath: protoConfig.claudeCodePath,
		vertexProjectId: protoConfig.vertexProjectId,
		vertexRegion: protoConfig.vertexRegion,
		openAiBaseUrl: protoConfig.openAiBaseUrl,
		openAiApiKey: protoConfig.openAiApiKey,
		ollamaBaseUrl: protoConfig.ollamaBaseUrl,
		ollamaApiOptionsCtxNum: protoConfig.ollamaApiOptionsCtxNum,
		lmStudioBaseUrl: protoConfig.lmStudioBaseUrl,
		geminiApiKey: protoConfig.geminiApiKey,
		geminiBaseUrl: protoConfig.geminiBaseUrl,
		openAiNativeApiKey: protoConfig.openAiNativeApiKey,
		deepSeekApiKey: protoConfig.deepSeekApiKey,
		requestyApiKey: protoConfig.requestyApiKey,
		togetherApiKey: protoConfig.togetherApiKey,
		fireworksApiKey: protoConfig.fireworksApiKey,
		fireworksModelMaxCompletionTokens: protoConfig.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: protoConfig.fireworksModelMaxTokens,
		qwenApiKey: protoConfig.qwenApiKey,
		doubaoApiKey: protoConfig.doubaoApiKey,
		mistralApiKey: protoConfig.mistralApiKey,
		azureApiVersion: protoConfig.azureApiVersion,
		qwenApiLine: protoConfig.qwenApiLine,
		moonshotApiLine: protoConfig.moonshotApiLine,
		moonshotApiKey: protoConfig.moonshotApiKey,
		huggingFaceApiKey: protoConfig.huggingFaceApiKey,
		nebiusApiKey: protoConfig.nebiusApiKey,
		asksageApiUrl: protoConfig.asksageApiUrl,
		asksageApiKey: protoConfig.asksageApiKey,
		xaiApiKey: protoConfig.xaiApiKey,
		sambanovaApiKey: protoConfig.sambanovaApiKey,
		cerebrasApiKey: protoConfig.cerebrasApiKey,
		groqApiKey: protoConfig.groqApiKey,
		requestTimeoutMs: protoConfig.requestTimeoutMs,
		sapAiCoreClientId: protoConfig.sapAiCoreClientId,
		sapAiCoreClientSecret: protoConfig.sapAiCoreClientSecret,
		sapAiResourceGroup: protoConfig.sapAiResourceGroup,
		sapAiCoreTokenUrl: protoConfig.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: protoConfig.sapAiCoreBaseUrl,

		// Plan mode configurations
		planModeApiProvider:
			protoConfig.planModeApiProvider !== undefined
				? convertProtoToApiProvider(protoConfig.planModeApiProvider)
				: undefined,
		planModeApiModelId: protoConfig.planModeApiModelId,
		planModeThinkingBudgetTokens: protoConfig.planModeThinkingBudgetTokens,
		planModeReasoningEffort: protoConfig.planModeReasoningEffort,
		planModeVsCodeLmModelSelector: protoConfig.planModeVsCodeLmModelSelector,
		planModeAwsBedrockCustomSelected: protoConfig.planModeAwsBedrockCustomSelected,
		planModeAwsBedrockCustomModelBaseId: protoConfig.planModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		planModeOpenRouterModelId: protoConfig.planModeOpenRouterModelId,
		planModeOpenRouterModelInfo: convertProtoToModelInfo(protoConfig.planModeOpenRouterModelInfo),
		planModeOpenAiModelId: protoConfig.planModeOpenAiModelId,
		planModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(protoConfig.planModeOpenAiModelInfo),
		planModeOllamaModelId: protoConfig.planModeOllamaModelId,
		planModeLmStudioModelId: protoConfig.planModeLmStudioModelId,
		planModeLiteLlmModelId: protoConfig.planModeLiteLlmModelId,
		planModeLiteLlmModelInfo: convertProtoToLiteLLMModelInfo(protoConfig.planModeLiteLlmModelInfo),
		planModeRequestyModelId: protoConfig.planModeRequestyModelId,
		planModeRequestyModelInfo: convertProtoToModelInfo(protoConfig.planModeRequestyModelInfo),
		planModeTogetherModelId: protoConfig.planModeTogetherModelId,
		planModeFireworksModelId: protoConfig.planModeFireworksModelId,
		planModeGroqModelId: protoConfig.planModeGroqModelId,
		planModeGroqModelInfo: convertProtoToModelInfo(protoConfig.planModeGroqModelInfo),
		planModeHuggingFaceModelId: protoConfig.planModeHuggingFaceModelId,
		planModeHuggingFaceModelInfo: convertProtoToModelInfo(protoConfig.planModeHuggingFaceModelInfo),
		planModeSapAiCoreModelId: protoConfig.planModeSapAiCoreModelId,

		// Act mode configurations
		actModeApiProvider:
			protoConfig.actModeApiProvider !== undefined ? convertProtoToApiProvider(protoConfig.actModeApiProvider) : undefined,
		actModeApiModelId: protoConfig.actModeApiModelId,
		actModeThinkingBudgetTokens: protoConfig.actModeThinkingBudgetTokens,
		actModeReasoningEffort: protoConfig.actModeReasoningEffort,
		actModeVsCodeLmModelSelector: protoConfig.actModeVsCodeLmModelSelector,
		actModeAwsBedrockCustomSelected: protoConfig.actModeAwsBedrockCustomSelected,
		actModeAwsBedrockCustomModelBaseId: protoConfig.actModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		actModeOpenRouterModelId: protoConfig.actModeOpenRouterModelId,
		actModeOpenRouterModelInfo: convertProtoToModelInfo(protoConfig.actModeOpenRouterModelInfo),
		actModeOpenAiModelId: protoConfig.actModeOpenAiModelId,
		actModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(protoConfig.actModeOpenAiModelInfo),
		actModeOllamaModelId: protoConfig.actModeOllamaModelId,
		actModeLmStudioModelId: protoConfig.actModeLmStudioModelId,
		actModeLiteLlmModelId: protoConfig.actModeLiteLlmModelId,
		actModeLiteLlmModelInfo: convertProtoToLiteLLMModelInfo(protoConfig.actModeLiteLlmModelInfo),
		actModeRequestyModelId: protoConfig.actModeRequestyModelId,
		actModeRequestyModelInfo: convertProtoToModelInfo(protoConfig.actModeRequestyModelInfo),
		actModeTogetherModelId: protoConfig.actModeTogetherModelId,
		actModeFireworksModelId: protoConfig.actModeFireworksModelId,
		actModeGroqModelId: protoConfig.actModeGroqModelId,
		actModeGroqModelInfo: convertProtoToModelInfo(protoConfig.actModeGroqModelInfo),
		actModeHuggingFaceModelId: protoConfig.actModeHuggingFaceModelId,
		actModeHuggingFaceModelInfo: convertProtoToModelInfo(protoConfig.actModeHuggingFaceModelInfo),
		actModeSapAiCoreModelId: protoConfig.actModeSapAiCoreModelId,

		// Favorited model IDs
		favoritedModelIds:
			protoConfig.favoritedModelIds && protoConfig.favoritedModelIds.length > 0 ? protoConfig.favoritedModelIds : undefined,
	}
}
