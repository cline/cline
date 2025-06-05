import { ModelInfo } from "@shared/api"
import { OpenRouterModelInfo, OpenRouterCompatibleModelInfo } from "@shared/proto/models"

/**
 * Converts ModelInfo to OpenRouterModelInfo for proto
 * @param modelInfo ModelInfo object
 * @returns OpenRouterModelInfo object suitable for proto
 */
export function convertModelInfoToProto(modelInfo: ModelInfo): OpenRouterModelInfo {
	return OpenRouterModelInfo.create({
		maxTokens: modelInfo.maxTokens ?? 0,
		contextWindow: modelInfo.contextWindow ?? 0,
		supportsImages: modelInfo.supportsImages ?? false,
		supportsPromptCache: modelInfo.supportsPromptCache ?? false,
		inputPrice: modelInfo.inputPrice ?? 0,
		outputPrice: modelInfo.outputPrice ?? 0,
		cacheWritesPrice: modelInfo.cacheWritesPrice ?? 0,
		cacheReadsPrice: modelInfo.cacheReadsPrice ?? 0,
		description: modelInfo.description ?? "",
	})
}

/**
 * Converts OpenRouterModelInfo from proto to ModelInfo
 * @param protoModelInfo OpenRouterModelInfo object from proto
 * @returns ModelInfo object
 */
export function convertProtoToModelInfo(protoModelInfo: OpenRouterModelInfo): ModelInfo {
	return {
		maxTokens: protoModelInfo.maxTokens || undefined,
		contextWindow: protoModelInfo.contextWindow || undefined,
		supportsImages: protoModelInfo.supportsImages,
		supportsPromptCache: protoModelInfo.supportsPromptCache,
		inputPrice: protoModelInfo.inputPrice || undefined,
		outputPrice: protoModelInfo.outputPrice || undefined,
		cacheWritesPrice: protoModelInfo.cacheWritesPrice || undefined,
		cacheReadsPrice: protoModelInfo.cacheReadsPrice || undefined,
		description: protoModelInfo.description || undefined,
	}
}

/**
 * Converts a record of ModelInfo objects to a record of OpenRouterModelInfo objects
 * @param models Record of ModelInfo objects
 * @returns Record of OpenRouterModelInfo objects suitable for proto
 */
export function convertModelInfoRecordToProto(models: Record<string, ModelInfo>): Record<string, OpenRouterModelInfo> {
	const protoModels: Record<string, OpenRouterModelInfo> = {}

	for (const [key, model] of Object.entries(models)) {
		protoModels[key] = convertModelInfoToProto(model)
	}

	return protoModels
}

/**
 * Converts a record of OpenRouterModelInfo objects to a record of ModelInfo objects
 * @param protoModels Record of OpenRouterModelInfo objects from proto
 * @returns Record of ModelInfo objects
 */
export function convertProtoToModelInfoRecord(protoModels: Record<string, OpenRouterModelInfo>): Record<string, ModelInfo> {
	const models: Record<string, ModelInfo> = {}

	for (const [key, protoModel] of Object.entries(protoModels)) {
		models[key] = convertProtoToModelInfo(protoModel)
	}

	return models
}

/**
 * Converts a record of ModelInfo objects to OpenRouterCompatibleModelInfo
 * @param models Record of ModelInfo objects
 * @returns OpenRouterCompatibleModelInfo suitable for proto
 */
export function convertModelInfoRecordToOpenRouterCompatibleModelInfo(
	models: Record<string, ModelInfo>,
): OpenRouterCompatibleModelInfo {
	return OpenRouterCompatibleModelInfo.create({
		models: convertModelInfoRecordToProto(models),
	})
}

/**
 * Converts OpenRouterCompatibleModelInfo to a record of ModelInfo objects
 * @param protoModelInfo OpenRouterCompatibleModelInfo from proto
 * @returns Record of ModelInfo objects
 */
export function convertOpenRouterCompatibleModelInfoToModelInfoRecord(
	protoModelInfo: OpenRouterCompatibleModelInfo,
): Record<string, ModelInfo> {
	return convertProtoToModelInfoRecord(protoModelInfo.models)
}
