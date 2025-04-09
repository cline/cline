import { ModelInfo } from "../shared/api"

function calculateApiCostInternal(
	modelInfo: ModelInfo,
	inputTokens: number, // Note: For OpenAI-style, this is non-cached tokens. For Anthropic-style, this is total input tokens.
	outputTokens: number,
	cacheCreationInputTokens: number,
	cacheReadInputTokens: number,
	totalInputTokensForPricing?: number, // The *total* input tokens, used for tiered pricing lookup
): number {
	// Determine effective input price
	let effectiveInputPrice = modelInfo.inputPrice || 0
	if (modelInfo.inputPriceTiers && modelInfo.inputPriceTiers.length > 0 && totalInputTokensForPricing !== undefined) {
		// Ensure tiers are sorted by tokenLimit ascending before finding
		const sortedInputTiers = [...modelInfo.inputPriceTiers].sort((a, b) => a.tokenLimit - b.tokenLimit)
		// Find the first tier where the total input tokens are less than or equal to the limit
		const tier = sortedInputTiers.find((t) => totalInputTokensForPricing! <= t.tokenLimit)
		if (tier) {
			effectiveInputPrice = tier.price
		} else {
			// Should ideally not happen if Infinity is used for the last tier, but fallback just in case
			effectiveInputPrice = sortedInputTiers[sortedInputTiers.length - 1]?.price || 0
		}
	}

	// Determine effective output price (based on total *input* tokens for pricing)
	let effectiveOutputPrice = modelInfo.outputPrice || 0
	if (modelInfo.outputPriceTiers && modelInfo.outputPriceTiers.length > 0 && totalInputTokensForPricing !== undefined) {
		// Ensure tiers are sorted by tokenLimit ascending before finding
		const sortedOutputTiers = [...modelInfo.outputPriceTiers].sort((a, b) => a.tokenLimit - b.tokenLimit)
		const tier = sortedOutputTiers.find((t) => totalInputTokensForPricing! <= t.tokenLimit)
		if (tier) {
			effectiveOutputPrice = tier.price
		} else {
			// Should ideally not happen if Infinity is used for the last tier, but fallback just in case
			effectiveOutputPrice = sortedOutputTiers[sortedOutputTiers.length - 1]?.price || 0
		}
	}

	const cacheWritesCost = ((modelInfo.cacheWritesPrice || 0) / 1_000_000) * cacheCreationInputTokens
	const cacheReadsCost = ((modelInfo.cacheReadsPrice || 0) / 1_000_000) * cacheReadInputTokens
	// Use effectiveInputPrice for baseInputCost. Note: 'inputTokens' here is the potentially adjusted count (e.g., non-cached for OpenAI)
	const baseInputCost = (effectiveInputPrice / 1_000_000) * inputTokens
	// Use effectiveOutputPrice for outputCost
	const outputCost = (effectiveOutputPrice / 1_000_000) * outputTokens

	const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost
	return totalCost
}

// For Anthropic compliant usage, the input tokens count does NOT include the cached tokens
export function calculateApiCostAnthropic(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Anthropic style doesn't need totalInputTokensForPricing as its inputTokens already represents the total
	return calculateApiCostInternal(
		modelInfo,
		inputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		undefined, // Pass undefined for totalInputTokensForPricing
	)
}

// For OpenAI compliant usage, the input tokens count INCLUDES the cached tokens
export function calculateApiCostOpenAI(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Calculate non-cached tokens for the internal function's 'inputTokens' parameter
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	// Pass the original 'inputTokens' as 'totalInputTokensForPricing' for tier lookup
	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens, // Pass the adjusted token count here
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens, // Pass the original total input tokens for pricing tier lookup
	)
}
