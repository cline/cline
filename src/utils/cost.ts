import { ModelInfo } from "@shared/api"

function calculateApiCostInternal(
	modelInfo: ModelInfo,
	inputTokens: number, // Note: For OpenAI-style, this is non-cached tokens. For Anthropic-style, this is total input tokens.
	outputTokens: number,
	cacheCreationInputTokens: number,
	cacheReadInputTokens: number,
	totalInputTokensForPricing?: number, // The *total* input tokens, used for tiered pricing lookup
	thinkingBudgetTokens?: number, // Add thinking budget info
): number {
	const usedThinkingBudget = thinkingBudgetTokens && thinkingBudgetTokens > 0

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

	// Determine effective output price
	let effectiveOutputPrice = modelInfo.outputPrice || 0
	// Check if thinking budget was used and has a specific price
	if (usedThinkingBudget && modelInfo.thinkingConfig?.outputPrice !== undefined) {
		effectiveOutputPrice = modelInfo.thinkingConfig.outputPrice
		// TODO: Add support for tiered thinking budget output pricing if needed in the future
		// } else if (usedThinkingBudget && modelInfo.thinkingConfig?.outputPriceTiers) { ... }
	} else if (modelInfo.outputPriceTiers && modelInfo.outputPriceTiers.length > 0 && totalInputTokensForPricing !== undefined) {
		// Use standard tiered output pricing (based on total *input* tokens for pricing)
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
	thinkingBudgetTokens?: number,
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Anthropic style: inputTokens already represents the total, so pass it directly for tiered pricing lookup if needed
	// (though Anthropic models currently don't use tiered pricing based on input size)
	// Anthropic style doesn't need totalInputTokensForPricing as its inputTokens already represents the total
	return calculateApiCostInternal(
		modelInfo,
		inputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		thinkingBudgetTokens,
	)
}

// For OpenAI compliant usage, the input tokens count INCLUDES the cached tokens
export function calculateApiCostOpenAI(
	modelInfo: ModelInfo,
	inputTokens: number, // For OpenAI-style, this includes cached tokens
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number, // Pass thinking budget info
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Calculate non-cached tokens for the internal function's 'inputTokens' parameter
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	// Pass the original 'inputTokens' as 'totalInputTokensForPricing' for tier lookup
	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		thinkingBudgetTokens,
	)
}
