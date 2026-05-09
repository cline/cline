import {
	LiteLLMModelInfo,
	OpenAiCompatibleModelInfo,
	OpenRouterModelInfo,
	ModelsApiConfiguration as ProtoApiConfiguration,
	ApiProvider as ProtoApiProvider,
	OcaModelInfo as ProtoOcaModelInfo,
	ThinkingConfig,
} from "@shared/proto/cline/models"
import { ModeConfig as ProtoModeConfig } from "@shared/proto/cline/models"
import {
	ApiConfiguration,
	ApiProvider,
	LiteLLMModelInfo as AppLiteLLMModelInfo,
	OpenAiCompatibleModelInfo as AppOpenAiCompatibleModelInfo,
	DEFAULT_API_PROVIDER,
	ModelInfo,
	OcaModelInfo,
} from "../../api"
import { ModeConfigSettings } from "../../storage/state-keys"

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

// Convert application ModelInfo to proto OcaModelInfo
function convertOcaModelInfoToProtoOcaModelInfo(info: OcaModelInfo | undefined): ProtoOcaModelInfo | undefined {
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
		surveyContent: info.surveyContent,
		surveyId: info.surveyId,
		banner: info.banner,
		modelName: info.modelName,
		apiFormat: info.apiFormat,
		supportsReasoning: info.supportsReasoning,
		reasoningEffortOptions: info.reasoningEffortOptions,
	}
}

// Convert proto OpenRouterModelInfo to application ModelInfo
function convertProtoOcaModelInfoToOcaModelInfo(info: ProtoOcaModelInfo | undefined): OcaModelInfo | undefined {
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
		surveyContent: info.surveyContent,
		surveyId: info.surveyId,
		banner: info.banner,
		modelName: info.modelName,
		apiFormat: info.apiFormat,
		supportsReasoning: info.supportsReasoning,
		reasoningEffortOptions: info.reasoningEffortOptions,
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
		supportsReasoning: info.supportsReasoning,
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
		supportsReasoning: info.supportsReasoning,
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
		case "qwen-code":
			return ProtoApiProvider.QWEN_CODE
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
		case "wandb":
			return ProtoApiProvider.WANDB
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
		case "baseten":
			return ProtoApiProvider.BASETEN
		case "sapaicore":
			return ProtoApiProvider.SAPAICORE
		case "claude-code":
			return ProtoApiProvider.CLAUDE_CODE
		case "huawei-cloud-maas":
			return ProtoApiProvider.HUAWEI_CLOUD_MAAS
		case "vercel-ai-gateway":
			return ProtoApiProvider.VERCEL_AI_GATEWAY
		case "zai":
			return ProtoApiProvider.ZAI
		case "dify":
			return ProtoApiProvider.DIFY
		case "oca":
			return ProtoApiProvider.OCA
		case "aihubmix":
			return ProtoApiProvider.AIHUBMIX
		case "minimax":
			return ProtoApiProvider.MINIMAX
		case "hicap":
			return ProtoApiProvider.HICAP
		case "nousResearch":
			return ProtoApiProvider.NOUSRESEARCH
		case "openai-codex":
			return ProtoApiProvider.OPENAI_CODEX
		default:
			return ProtoApiProvider.ANTHROPIC
	}
}

// Convert proto ApiProvider to application ApiProvider
export function convertProtoToApiProvider(provider: ProtoApiProvider): ApiProvider {
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
		case ProtoApiProvider.QWEN_CODE:
			return "qwen-code"
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
		case ProtoApiProvider.WANDB:
			return "wandb"
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
		case ProtoApiProvider.BASETEN:
			return "baseten"
		case ProtoApiProvider.SAPAICORE:
			return "sapaicore"
		case ProtoApiProvider.CLAUDE_CODE:
			return "claude-code"
		case ProtoApiProvider.HUAWEI_CLOUD_MAAS:
			return "huawei-cloud-maas"
		case ProtoApiProvider.VERCEL_AI_GATEWAY:
			return "vercel-ai-gateway"
		case ProtoApiProvider.ZAI:
			return "zai"
		case ProtoApiProvider.HICAP:
			return "hicap"
		case ProtoApiProvider.DIFY:
			return "dify"
		case ProtoApiProvider.OCA:
			return "oca"
		case ProtoApiProvider.AIHUBMIX:
			return "aihubmix"
		case ProtoApiProvider.MINIMAX:
			return "minimax"
		case ProtoApiProvider.NOUSRESEARCH:
			return "nousResearch"
		case ProtoApiProvider.OPENAI_CODEX:
			return "openai-codex"
		default:
			return "anthropic"
	}
}

function convertModeConfigToProto(mc: ModeConfigSettings | undefined): ProtoModeConfig | undefined {
	if (!mc) {
		return undefined
	}
	return {
		apiProvider: mc.apiProvider ? convertApiProviderToProto(mc.apiProvider) : undefined,
		modelId: mc.modelId,
		modelInfo: mc.modelInfo ? JSON.stringify(mc.modelInfo) : undefined,
		thinkingBudgetTokens: mc.thinkingBudgetTokens,
		reasoningEffort: mc.reasoningEffort,
		verbosity: mc.verbosity,
		geminiThinkingLevel: mc.geminiThinkingLevel,
		vsCodeLmModelSelector: mc.vsCodeLmModelSelector,
		awsBedrockCustomSelected: mc.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: mc.awsBedrockCustomModelBaseId,
		sapAiCoreDeploymentId: mc.sapAiCoreDeploymentId,
		ocaReasoningEffort: mc.ocaReasoningEffort,
	}
}

export function convertProtoToModeConfig(mc: ProtoModeConfig | undefined): ModeConfigSettings | undefined {
	if (!mc) {
		return undefined
	}
	let modelInfo: ModeConfigSettings["modelInfo"] | undefined
	if (mc.modelInfo) {
		try {
			modelInfo = JSON.parse(mc.modelInfo) as ModeConfigSettings["modelInfo"]
		} catch {
			modelInfo = undefined
		}
	}
	return {
		apiProvider: mc.apiProvider !== undefined ? convertProtoToApiProvider(mc.apiProvider) : DEFAULT_API_PROVIDER,
		modelId: mc.modelId,
		modelInfo,
		thinkingBudgetTokens: mc.thinkingBudgetTokens as number | undefined,
		reasoningEffort: mc.reasoningEffort,
		verbosity: mc.verbosity,
		geminiThinkingLevel: mc.geminiThinkingLevel,
		vsCodeLmModelSelector: mc.vsCodeLmModelSelector,
		awsBedrockCustomSelected: mc.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: mc.awsBedrockCustomModelBaseId,
		sapAiCoreDeploymentId: mc.sapAiCoreDeploymentId,
		ocaReasoningEffort: mc.ocaReasoningEffort,
	}
}

// Converts application ApiConfiguration to proto ApiConfiguration
export function convertApiConfigurationToProto(config: ApiConfiguration): ProtoApiConfiguration {
	return {
		// Global configuration fields
		apiKey: config.apiKey,
		clineAccountId: config.clineAccountId,
		ulid: config.ulid,
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
		awsUseGlobalInference: config.awsUseGlobalInference,
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
		ollamaApiKey: config.ollamaApiKey,
		ollamaApiOptionsCtxNum: config.ollamaApiOptionsCtxNum,
		lmStudioBaseUrl: config.lmStudioBaseUrl,
		lmStudioMaxTokens: config.lmStudioMaxTokens,
		geminiApiKey: config.geminiApiKey,
		geminiBaseUrl: config.geminiBaseUrl,
		openAiNativeApiKey: config.openAiNativeApiKey,
		deepSeekApiKey: config.deepSeekApiKey,
		requestyApiKey: config.requestyApiKey,
		requestyBaseUrl: config.requestyBaseUrl,
		togetherApiKey: config.togetherApiKey,
		fireworksApiKey: config.fireworksApiKey,
		fireworksModelMaxCompletionTokens: config.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: config.fireworksModelMaxTokens,
		qwenApiKey: config.qwenApiKey,
		qwenCodeOauthPath: config.qwenCodeOauthPath,
		doubaoApiKey: config.doubaoApiKey,
		mistralApiKey: config.mistralApiKey,
		azureApiVersion: config.azureApiVersion,
		azureIdentity: config.azureIdentity,
		qwenApiLine: config.qwenApiLine,
		moonshotApiLine: config.moonshotApiLine,
		moonshotApiKey: config.moonshotApiKey,
		huggingFaceApiKey: config.huggingFaceApiKey,
		nebiusApiKey: config.nebiusApiKey,
		wandbApiKey: config.wandbApiKey,
		asksageApiUrl: config.asksageApiUrl,
		asksageApiKey: config.asksageApiKey,
		xaiApiKey: config.xaiApiKey,
		sambanovaApiKey: config.sambanovaApiKey,
		cerebrasApiKey: config.cerebrasApiKey,
		vercelAiGatewayApiKey: config.vercelAiGatewayApiKey,
		groqApiKey: config.groqApiKey,
		basetenApiKey: config.basetenApiKey,
		requestTimeoutMs: config.requestTimeoutMs,
		sapAiCoreClientId: config.sapAiCoreClientId,
		sapAiCoreClientSecret: config.sapAiCoreClientSecret,
		sapAiResourceGroup: config.sapAiResourceGroup,
		sapAiCoreTokenUrl: config.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: config.sapAiCoreBaseUrl,
		sapAiCoreUseOrchestrationMode: config.sapAiCoreUseOrchestrationMode,
		huaweiCloudMaasApiKey: config.huaweiCloudMaasApiKey,
		zaiApiLine: config.zaiApiLine,
		zaiApiKey: config.zaiApiKey,
		difyApiKey: config.difyApiKey,
		difyBaseUrl: config.difyBaseUrl,
		ocaBaseUrl: config.ocaBaseUrl,
		minimaxApiKey: config.minimaxApiKey,
		minimaxApiLine: config.minimaxApiLine,
		nousResearchApiKey: config.nousResearchApiKey,
		clineApiKey: config.clineApiKey,
		ocaMode: config.ocaMode,
		aihubmixApiKey: config.aihubmixApiKey,
		aihubmixBaseUrl: config.aihubmixBaseUrl,
		aihubmixAppCode: config.aihubmixAppCode,
		hicapApiKey: config.hicapApiKey,
		// Mode-specific configuration (nested)
		planConfig: convertModeConfigToProto(config.planConfig),
		actConfig: convertModeConfigToProto(config.actConfig),
	}
}

// Converts proto ApiConfiguration to application ApiConfiguration
export function convertProtoToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	return {
		// Global configuration fields
		apiKey: protoConfig.apiKey,
		clineAccountId: protoConfig.clineAccountId,
		ulid: protoConfig.ulid,
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
		awsUseGlobalInference: protoConfig.awsUseGlobalInference,
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
		ollamaApiKey: protoConfig.ollamaApiKey,
		ollamaApiOptionsCtxNum: protoConfig.ollamaApiOptionsCtxNum,
		lmStudioBaseUrl: protoConfig.lmStudioBaseUrl,
		lmStudioMaxTokens: protoConfig.lmStudioMaxTokens,
		geminiApiKey: protoConfig.geminiApiKey,
		geminiBaseUrl: protoConfig.geminiBaseUrl,
		openAiNativeApiKey: protoConfig.openAiNativeApiKey,
		deepSeekApiKey: protoConfig.deepSeekApiKey,
		requestyApiKey: protoConfig.requestyApiKey,
		requestyBaseUrl: protoConfig.requestyBaseUrl,
		togetherApiKey: protoConfig.togetherApiKey,
		fireworksApiKey: protoConfig.fireworksApiKey,
		fireworksModelMaxCompletionTokens: protoConfig.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: protoConfig.fireworksModelMaxTokens,
		qwenApiKey: protoConfig.qwenApiKey,
		qwenCodeOauthPath: protoConfig.qwenCodeOauthPath,
		doubaoApiKey: protoConfig.doubaoApiKey,
		mistralApiKey: protoConfig.mistralApiKey,
		azureApiVersion: protoConfig.azureApiVersion,
		azureIdentity: protoConfig.azureIdentity,
		qwenApiLine: protoConfig.qwenApiLine,
		moonshotApiLine: protoConfig.moonshotApiLine,
		moonshotApiKey: protoConfig.moonshotApiKey,
		huggingFaceApiKey: protoConfig.huggingFaceApiKey,
		nebiusApiKey: protoConfig.nebiusApiKey,
		wandbApiKey: protoConfig.wandbApiKey,
		asksageApiUrl: protoConfig.asksageApiUrl,
		asksageApiKey: protoConfig.asksageApiKey,
		xaiApiKey: protoConfig.xaiApiKey,
		sambanovaApiKey: protoConfig.sambanovaApiKey,
		cerebrasApiKey: protoConfig.cerebrasApiKey,
		vercelAiGatewayApiKey: protoConfig.vercelAiGatewayApiKey,
		groqApiKey: protoConfig.groqApiKey,
		basetenApiKey: protoConfig.basetenApiKey,
		requestTimeoutMs: protoConfig.requestTimeoutMs,
		sapAiCoreClientId: protoConfig.sapAiCoreClientId,
		sapAiCoreClientSecret: protoConfig.sapAiCoreClientSecret,
		sapAiResourceGroup: protoConfig.sapAiResourceGroup,
		sapAiCoreTokenUrl: protoConfig.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: protoConfig.sapAiCoreBaseUrl,
		sapAiCoreUseOrchestrationMode: protoConfig.sapAiCoreUseOrchestrationMode,
		huaweiCloudMaasApiKey: protoConfig.huaweiCloudMaasApiKey,
		zaiApiLine: protoConfig.zaiApiLine,
		zaiApiKey: protoConfig.zaiApiKey,
		difyApiKey: protoConfig.difyApiKey,
		difyBaseUrl: protoConfig.difyBaseUrl,
		ocaBaseUrl: protoConfig.ocaBaseUrl,
		ocaMode: protoConfig.ocaMode,
		aihubmixApiKey: protoConfig.aihubmixApiKey,
		aihubmixBaseUrl: protoConfig.aihubmixBaseUrl,
		aihubmixAppCode: protoConfig.aihubmixAppCode,
		minimaxApiKey: protoConfig.minimaxApiKey,
		minimaxApiLine: protoConfig.minimaxApiLine,
		hicapApiKey: protoConfig.hicapApiKey,
		nousResearchApiKey: protoConfig.nousResearchApiKey,
		clineApiKey: protoConfig.clineApiKey,

		// Mode-specific configuration (nested)
		planConfig: convertProtoToModeConfig(protoConfig.planConfig),
		actConfig: convertProtoToModeConfig(protoConfig.actConfig),
	}
}
