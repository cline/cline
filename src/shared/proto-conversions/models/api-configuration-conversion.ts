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
} from "../../proto/models"

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
		apiModelId: config.apiModelId,
		apiKey: config.apiKey,
		clineApiKey: config.clineApiKey,
		taskId: config.taskId,
		liteLlmBaseUrl: config.liteLlmBaseUrl,
		liteLlmModelId: config.liteLlmModelId,
		liteLlmApiKey: config.liteLlmApiKey,
		liteLlmUsePromptCache: config.liteLlmUsePromptCache,
		openAiHeaders: config.openAiHeaders || {},
		liteLlmModelInfo: convertLiteLLMModelInfoToProto(config.liteLlmModelInfo),
		anthropicBaseUrl: config.anthropicBaseUrl,
		openRouterApiKey: config.openRouterApiKey,
		openRouterModelId: config.openRouterModelId,
		openRouterModelInfo: convertModelInfoToProtoOpenRouter(config.openRouterModelInfo),
		openRouterProviderSorting: config.openRouterProviderSorting,
		awsAccessKey: config.awsAccessKey,
		awsSecretKey: config.awsSecretKey,
		awsSessionToken: config.awsSessionToken,
		awsRegion: config.awsRegion,
		awsUseCrossRegionInference: config.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: config.awsBedrockUsePromptCache,
		awsUseProfile: config.awsUseProfile,
		awsProfile: config.awsProfile,
		awsBedrockEndpoint: config.awsBedrockEndpoint,
		awsBedrockCustomSelected: config.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: config.awsBedrockCustomModelBaseId as string | undefined,
		vertexProjectId: config.vertexProjectId,
		vertexRegion: config.vertexRegion,
		openAiBaseUrl: config.openAiBaseUrl,
		openAiApiKey: config.openAiApiKey,
		openAiModelId: config.openAiModelId,
		openAiModelInfo: convertOpenAiCompatibleModelInfoToProto(config.openAiModelInfo),
		ollamaModelId: config.ollamaModelId,
		ollamaBaseUrl: config.ollamaBaseUrl,
		ollamaApiOptionsCtxNum: config.ollamaApiOptionsCtxNum,
		lmStudioModelId: config.lmStudioModelId,
		lmStudioBaseUrl: config.lmStudioBaseUrl,
		geminiApiKey: config.geminiApiKey,
		geminiBaseUrl: config.geminiBaseUrl,
		openAiNativeApiKey: config.openAiNativeApiKey,
		deepSeekApiKey: config.deepSeekApiKey,
		requestyApiKey: config.requestyApiKey,
		requestyModelId: config.requestyModelId,
		requestyModelInfo: convertModelInfoToProtoOpenRouter(config.requestyModelInfo),
		togetherApiKey: config.togetherApiKey,
		togetherModelId: config.togetherModelId,
		fireworksApiKey: config.fireworksApiKey,
		fireworksModelId: config.fireworksModelId,
		fireworksModelMaxCompletionTokens: config.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: config.fireworksModelMaxTokens,
		qwenApiKey: config.qwenApiKey,
		doubaoApiKey: config.doubaoApiKey,
		mistralApiKey: config.mistralApiKey,
		azureApiVersion: config.azureApiVersion,
		vsCodeLmModelSelector: config.vsCodeLmModelSelector,
		qwenApiLine: config.qwenApiLine,
		nebiusApiKey: config.nebiusApiKey,
		asksageApiUrl: config.asksageApiUrl,
		asksageApiKey: config.asksageApiKey,
		xaiApiKey: config.xaiApiKey,
		thinkingBudgetTokens: config.thinkingBudgetTokens,
		reasoningEffort: config.reasoningEffort,
		sambanovaApiKey: config.sambanovaApiKey,
		cerebrasApiKey: config.cerebrasApiKey,
		requestTimeoutMs: config.requestTimeoutMs,
		apiProvider: config.apiProvider ? convertApiProviderToProto(config.apiProvider) : undefined,
		favoritedModelIds: config.favoritedModelIds || [],
		sapAiCoreClientId: config.sapAiCoreClientId,
		sapAiCoreClientSecret: config.sapAiCoreClientSecret,
		sapAiResourceGroup: config.sapAiResourceGroup,
		sapAiCoreTokenUrl: config.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: config.sapAiCoreBaseUrl,
		claudeCodePath: config.claudeCodePath,
	}
}

// Converts proto ApiConfiguration to application ApiConfiguration
export function convertProtoToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	return {
		apiModelId: protoConfig.apiModelId,
		apiKey: protoConfig.apiKey,
		clineApiKey: protoConfig.clineApiKey,
		taskId: protoConfig.taskId,
		liteLlmBaseUrl: protoConfig.liteLlmBaseUrl,
		liteLlmModelId: protoConfig.liteLlmModelId,
		liteLlmApiKey: protoConfig.liteLlmApiKey,
		liteLlmUsePromptCache: protoConfig.liteLlmUsePromptCache,
		openAiHeaders: Object.keys(protoConfig.openAiHeaders).length > 0 ? protoConfig.openAiHeaders : undefined,
		liteLlmModelInfo: convertProtoToLiteLLMModelInfo(protoConfig.liteLlmModelInfo),
		anthropicBaseUrl: protoConfig.anthropicBaseUrl,
		openRouterApiKey: protoConfig.openRouterApiKey,
		openRouterModelId: protoConfig.openRouterModelId,
		openRouterModelInfo: convertProtoToModelInfo(protoConfig.openRouterModelInfo),
		openRouterProviderSorting: protoConfig.openRouterProviderSorting,
		awsAccessKey: protoConfig.awsAccessKey,
		awsSecretKey: protoConfig.awsSecretKey,
		awsSessionToken: protoConfig.awsSessionToken,
		awsRegion: protoConfig.awsRegion,
		awsUseCrossRegionInference: protoConfig.awsUseCrossRegionInference,
		awsBedrockUsePromptCache: protoConfig.awsBedrockUsePromptCache,
		awsUseProfile: protoConfig.awsUseProfile,
		awsProfile: protoConfig.awsProfile,
		awsBedrockEndpoint: protoConfig.awsBedrockEndpoint,
		awsBedrockCustomSelected: protoConfig.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: protoConfig.awsBedrockCustomModelBaseId as BedrockModelId | undefined,
		vertexProjectId: protoConfig.vertexProjectId,
		vertexRegion: protoConfig.vertexRegion,
		openAiBaseUrl: protoConfig.openAiBaseUrl,
		openAiApiKey: protoConfig.openAiApiKey,
		openAiModelId: protoConfig.openAiModelId,
		openAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(protoConfig.openAiModelInfo),
		ollamaModelId: protoConfig.ollamaModelId,
		ollamaBaseUrl: protoConfig.ollamaBaseUrl,
		ollamaApiOptionsCtxNum: protoConfig.ollamaApiOptionsCtxNum,
		lmStudioModelId: protoConfig.lmStudioModelId,
		lmStudioBaseUrl: protoConfig.lmStudioBaseUrl,
		geminiApiKey: protoConfig.geminiApiKey,
		geminiBaseUrl: protoConfig.geminiBaseUrl,
		openAiNativeApiKey: protoConfig.openAiNativeApiKey,
		deepSeekApiKey: protoConfig.deepSeekApiKey,
		requestyApiKey: protoConfig.requestyApiKey,
		requestyModelId: protoConfig.requestyModelId,
		requestyModelInfo: convertProtoToModelInfo(protoConfig.requestyModelInfo),
		togetherApiKey: protoConfig.togetherApiKey,
		togetherModelId: protoConfig.togetherModelId,
		fireworksApiKey: protoConfig.fireworksApiKey,
		fireworksModelId: protoConfig.fireworksModelId,
		fireworksModelMaxCompletionTokens: protoConfig.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: protoConfig.fireworksModelMaxTokens,
		qwenApiKey: protoConfig.qwenApiKey,
		doubaoApiKey: protoConfig.doubaoApiKey,
		mistralApiKey: protoConfig.mistralApiKey,
		azureApiVersion: protoConfig.azureApiVersion,
		vsCodeLmModelSelector: protoConfig.vsCodeLmModelSelector,
		qwenApiLine: protoConfig.qwenApiLine,
		nebiusApiKey: protoConfig.nebiusApiKey,
		asksageApiUrl: protoConfig.asksageApiUrl,
		asksageApiKey: protoConfig.asksageApiKey,
		xaiApiKey: protoConfig.xaiApiKey,
		thinkingBudgetTokens: protoConfig.thinkingBudgetTokens,
		reasoningEffort: protoConfig.reasoningEffort,
		sambanovaApiKey: protoConfig.sambanovaApiKey,
		cerebrasApiKey: protoConfig.cerebrasApiKey,
		requestTimeoutMs: protoConfig.requestTimeoutMs,
		apiProvider: protoConfig.apiProvider !== undefined ? convertProtoToApiProvider(protoConfig.apiProvider) : undefined,
		favoritedModelIds: protoConfig.favoritedModelIds.length > 0 ? protoConfig.favoritedModelIds : undefined,
		sapAiCoreClientId: protoConfig.sapAiCoreClientId,
		sapAiCoreClientSecret: protoConfig.sapAiCoreClientSecret,
		sapAiResourceGroup: protoConfig.sapAiResourceGroup,
		sapAiCoreTokenUrl: protoConfig.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: protoConfig.sapAiCoreBaseUrl,
		claudeCodePath: protoConfig.claudeCodePath,
	}
}
