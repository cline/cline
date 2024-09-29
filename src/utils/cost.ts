import { ModelInfo } from "../shared/api"

export function calculateApiCost(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number
): number {
	const modelCacheWritesPrice = modelInfo.cacheWritesPrice
	let cacheWritesCost = 0
	if (cacheCreationInputTokens && modelCacheWritesPrice) {
		cacheWritesCost = (modelCacheWritesPrice / 1_000_000) * cacheCreationInputTokens
	}
	const modelCacheReadsPrice = modelInfo.cacheReadsPrice
	let cacheReadsCost = 0
	if (cacheReadInputTokens && modelCacheReadsPrice) {
		cacheReadsCost = (modelCacheReadsPrice / 1_000_000) * cacheReadInputTokens
	}
	const baseInputCost = (modelInfo.inputPrice / 1_000_000) * inputTokens
	const outputCost = (modelInfo.outputPrice / 1_000_000) * outputTokens
	const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost
	return totalCost
}
