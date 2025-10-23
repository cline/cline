import { LiteLLMModelInfo, ModelInfo, OcaModelInfo, OpenAiCompatibleModelInfo } from "@shared/api"
import {
	OpenRouterModelInfo,
	LiteLLMModelInfo as ProtoLiteLLMModelInfo,
	OcaModelInfo as ProtoOcaModelInfo,
	OpenAiCompatibleModelInfo as ProtoOpenAiCompatibleModelInfo,
	ThinkingConfig,
} from "@shared/proto/cline/models"

/**
 * Convert protobuf ThinkingConfig to application ThinkingConfig
 * Converts empty arrays to undefined for optional fields
 */
function convertThinkingConfig(protoConfig: ThinkingConfig | undefined): ModelInfo["thinkingConfig"] | undefined {
	if (!protoConfig) {
		return undefined
	}

	return {
		maxBudget: protoConfig.maxBudget,
		outputPrice: protoConfig.outputPrice,
		outputPriceTiers: protoConfig.outputPriceTiers.length > 0 ? protoConfig.outputPriceTiers : undefined,
	}
}

/**
 * Convert application ThinkingConfig to protobuf ThinkingConfig
 * Converts undefined to empty arrays for proto fields
 */
function toProtobufThinkingConfig(appConfig: ModelInfo["thinkingConfig"] | undefined): ThinkingConfig | undefined {
	if (!appConfig) {
		return undefined
	}

	return ThinkingConfig.create({
		maxBudget: appConfig.maxBudget,
		outputPrice: appConfig.outputPrice,
		outputPriceTiers: appConfig.outputPriceTiers || [],
	})
}

/**
 * Convert protobuf OpenRouterModelInfo to application ModelInfo
 */
export function fromProtobufModelInfo(protoInfo: OpenRouterModelInfo): ModelInfo {
	return {
		maxTokens: protoInfo.maxTokens,
		contextWindow: protoInfo.contextWindow,
		supportsImages: protoInfo.supportsImages,
		supportsPromptCache: protoInfo.supportsPromptCache,
		inputPrice: protoInfo.inputPrice,
		outputPrice: protoInfo.outputPrice,
		cacheWritesPrice: protoInfo.cacheWritesPrice,
		cacheReadsPrice: protoInfo.cacheReadsPrice,
		description: protoInfo.description,
		thinkingConfig: convertThinkingConfig(protoInfo.thinkingConfig),
		supportsGlobalEndpoint: protoInfo.supportsGlobalEndpoint,
		tiers: protoInfo.tiers.length > 0 ? protoInfo.tiers : undefined,
	}
}

/**
 * Convert application ModelInfo to protobuf OpenRouterModelInfo
 */
export function toProtobufModelInfo(modelInfo: ModelInfo): OpenRouterModelInfo {
	return OpenRouterModelInfo.create({
		maxTokens: modelInfo.maxTokens,
		contextWindow: modelInfo.contextWindow,
		supportsImages: modelInfo.supportsImages,
		supportsPromptCache: modelInfo.supportsPromptCache,
		inputPrice: modelInfo.inputPrice,
		outputPrice: modelInfo.outputPrice,
		cacheWritesPrice: modelInfo.cacheWritesPrice,
		cacheReadsPrice: modelInfo.cacheReadsPrice,
		description: modelInfo.description,
		thinkingConfig: toProtobufThinkingConfig(modelInfo.thinkingConfig),
		supportsGlobalEndpoint: modelInfo.supportsGlobalEndpoint,
		tiers: modelInfo.tiers || [],
	})
}

/**
 * Convert protobuf OpenAiCompatibleModelInfo to application OpenAiCompatibleModelInfo
 */
export function fromProtobufOpenAiCompatibleModelInfo(protoInfo: ProtoOpenAiCompatibleModelInfo): OpenAiCompatibleModelInfo {
	return {
		maxTokens: protoInfo.maxTokens,
		contextWindow: protoInfo.contextWindow,
		supportsImages: protoInfo.supportsImages,
		supportsPromptCache: protoInfo.supportsPromptCache,
		inputPrice: protoInfo.inputPrice,
		outputPrice: protoInfo.outputPrice,
		cacheWritesPrice: protoInfo.cacheWritesPrice,
		cacheReadsPrice: protoInfo.cacheReadsPrice,
		description: protoInfo.description,
		thinkingConfig: convertThinkingConfig(protoInfo.thinkingConfig),
		supportsGlobalEndpoint: protoInfo.supportsGlobalEndpoint,
		tiers: protoInfo.tiers.length > 0 ? protoInfo.tiers : undefined,
		temperature: protoInfo.temperature,
		isR1FormatRequired: protoInfo.isR1FormatRequired,
	}
}

/**
 * Convert protobuf LiteLLMModelInfo to application LiteLLMModelInfo
 */
export function fromProtobufLiteLLMModelInfo(protoInfo: ProtoLiteLLMModelInfo): LiteLLMModelInfo {
	return {
		maxTokens: protoInfo.maxTokens,
		contextWindow: protoInfo.contextWindow,
		supportsImages: protoInfo.supportsImages,
		supportsPromptCache: protoInfo.supportsPromptCache,
		inputPrice: protoInfo.inputPrice,
		outputPrice: protoInfo.outputPrice,
		cacheWritesPrice: protoInfo.cacheWritesPrice,
		cacheReadsPrice: protoInfo.cacheReadsPrice,
		description: protoInfo.description,
		thinkingConfig: convertThinkingConfig(protoInfo.thinkingConfig),
		supportsGlobalEndpoint: protoInfo.supportsGlobalEndpoint,
		tiers: protoInfo.tiers.length > 0 ? protoInfo.tiers : undefined,
		temperature: protoInfo.temperature,
	}
}

/**
 * Convert protobuf OcaModelInfo to application OcaModelInfo
 */
export function fromProtobufOcaModelInfo(protoInfo: ProtoOcaModelInfo): OcaModelInfo {
	return {
		maxTokens: protoInfo.maxTokens,
		contextWindow: protoInfo.contextWindow,
		supportsImages: protoInfo.supportsImages,
		supportsPromptCache: protoInfo.supportsPromptCache,
		inputPrice: protoInfo.inputPrice,
		outputPrice: protoInfo.outputPrice,
		cacheWritesPrice: protoInfo.cacheWritesPrice,
		cacheReadsPrice: protoInfo.cacheReadsPrice,
		description: protoInfo.description,
		thinkingConfig: convertThinkingConfig(protoInfo.thinkingConfig),
		temperature: protoInfo.temperature,
		modelName: protoInfo.modelName,
		surveyId: protoInfo.surveyId,
		banner: protoInfo.banner,
		surveyContent: protoInfo.surveyContent,
	}
}

/**
 * Convert a record of protobuf models to application models
 */
export function fromProtobufModels(protoModels: Record<string, OpenRouterModelInfo>): Record<string, ModelInfo> {
	const result: Record<string, ModelInfo> = {}
	for (const [key, value] of Object.entries(protoModels)) {
		result[key] = fromProtobufModelInfo(value)
	}
	return result
}

/**
 * Convert a record of application models to protobuf models
 */
export function toProtobufModels(models: Record<string, ModelInfo>): Record<string, OpenRouterModelInfo> {
	const result: Record<string, OpenRouterModelInfo> = {}
	for (const [key, value] of Object.entries(models)) {
		result[key] = toProtobufModelInfo(value)
	}
	return result
}
