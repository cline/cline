import type { ModelInfo } from "@shared/api"

/**
 * Formats a price as a currency string
 */
export const formatPrice = (price: number) => {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(price)
}

/**
 * Helper function to format token prices for display
 * @param price The price per million tokens
 */
export const formatTokenPrice = (price: number) => {
	return `${formatPrice(price)}/million tokens`
}

/**
 * Helper function to determine if a model supports thinking budget
 */
export const hasThinkingBudget = (modelInfo: ModelInfo): boolean => {
	return !!modelInfo.thinkingConfig && Object.keys(modelInfo.thinkingConfig).length > 0
}

/**
 * Helper function to check if a model supports images
 */
export const supportsImages = (modelInfo: ModelInfo): boolean => {
	return !!modelInfo.supportsImages
}

/**
 * Helper function to check if a model supports browser use
 */
export const supportsBrowserUse = (modelInfo: ModelInfo): boolean => {
	return !!modelInfo.supportsImages // browser tool uses image recognition
}

/**
 * Helper function to check if a model supports prompt caching
 * Checks both the model's metadata flag and known model ID/name patterns
 */
export const supportsPromptCache = (modelInfo: ModelInfo): boolean => {
	// First check the model's metadata
	if (modelInfo.supportsPromptCache) {
		return true
	}

	// Check for known models that support caching via model ID/name patterns
	// Check both name and description fields as they may contain the model identifier
	const modelName = modelInfo.name?.toLowerCase() || ""
	const modelDesc = modelInfo.description?.toLowerCase() || ""
	const searchText = `${modelName} ${modelDesc}`

	// All Grok models support prompt caching
	if (searchText.includes("grok")) {
		return true
	}

	// All xAI models support prompt caching
	if (searchText.includes("x-ai") || searchText.includes("xai")) {
		return true
	}

	// GPT-4o and o1 models support prompt caching
	if (
		searchText.includes("gpt-4o") ||
		searchText.includes("o1-preview") ||
		searchText.includes("o1-mini") ||
		searchText.includes("chatgpt-4o")
	) {
		return true
	}

	// Claude models support prompt caching
	if (searchText.includes("claude")) {
		return true
	}

	return false
}

/**
 * Helper function to format token limits for display
 */
export const formatTokenLimit = (limit: number): string => {
	return limit.toLocaleString()
}
