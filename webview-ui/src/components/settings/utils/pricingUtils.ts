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
 */
export const supportsPromptCache = (modelInfo: ModelInfo): boolean => {
	return !!modelInfo.supportsPromptCache
}

/**
 * Helper function to format token limits for display
 */
export const formatTokenLimit = (limit: number): string => {
	return limit.toLocaleString()
}
