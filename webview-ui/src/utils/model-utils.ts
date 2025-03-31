/**
 * Utility functions for working with language models and tokens
 */

/**
 * Default maximum tokens for thinking-capable models when no specific value is provided
 */
export const DEFAULT_THINKING_MODEL_MAX_TOKENS = 16_384

/**
 * Model information interface with properties used in token calculations
 */
export interface ModelInfo {
	/**
	 * Maximum number of tokens the model can process
	 */
	maxTokens?: number | null

	/**
	 * Whether the model supports thinking/reasoning capabilities
	 */
	thinking?: boolean
}

/**
 * API configuration interface with token-related settings
 */
export interface ApiConfig {
	/**
	 * Maximum tokens to use for model responses
	 */
	modelMaxTokens?: number
}
/**
 * Result of token distribution calculation
 */
export interface TokenDistributionResult {
	/**
	 * Percentage of context window used by current tokens (0-100)
	 */
	currentPercent: number

	/**
	 * Percentage of context window reserved for model output (0-100)
	 */
	reservedPercent: number

	/**
	 * Percentage of context window still available (0-100)
	 */
	availablePercent: number

	/**
	 * Number of tokens reserved for model output
	 */
	reservedForOutput: number

	/**
	 * Number of tokens still available in the context window
	 */
	availableSize: number
}

/**
 * Determines the maximum tokens based on model configuration
 * If the model supports thinking, prioritize the API configuration's modelMaxTokens,
 * falling back to the model's own maxTokens. Otherwise, just use the model's maxTokens.
 *
 * @param modelInfo The model information object with properties like maxTokens and thinking
 * @param apiConfig The API configuration object with properties like modelMaxTokens
 * @returns The maximum tokens value or undefined if no valid value is available
 */
export const getMaxTokensForModel = (
	modelInfo: ModelInfo | undefined,
	apiConfig: ApiConfig | undefined,
): number | undefined => {
	if (modelInfo?.thinking) {
		return apiConfig?.modelMaxTokens || DEFAULT_THINKING_MODEL_MAX_TOKENS
	}
	return modelInfo?.maxTokens ?? undefined
}

/**
 * Calculates distribution of tokens within the context window
 * This is used for visualizing the token distribution in the UI
 *
 * @param contextWindow The total size of the context window
 * @param contextTokens The number of tokens currently used
 * @param maxTokens Optional override for tokens reserved for model output (otherwise uses 20% of window)
 * @returns Distribution of tokens with percentages and raw numbers
 */
export const calculateTokenDistribution = (
	contextWindow: number,
	contextTokens: number,
	maxTokens?: number,
): TokenDistributionResult => {
	// Handle potential invalid inputs with positive fallbacks
	const safeContextWindow = Math.max(0, contextWindow)
	const safeContextTokens = Math.max(0, contextTokens)

	// Get the actual max tokens value from the model
	// If maxTokens is valid, use it, otherwise reserve 20% of the context window as a default
	const reservedForOutput = maxTokens && maxTokens > 0 ? maxTokens : Math.ceil(safeContextWindow * 0.2)

	// Calculate sizes directly without buffer display
	const availableSize = Math.max(0, safeContextWindow - safeContextTokens - reservedForOutput)

	// Calculate percentages - ensure they sum to exactly 100%
	// Use the ratio of each part to the total context window
	const total = safeContextTokens + reservedForOutput + availableSize

	// Safeguard against division by zero
	if (total <= 0) {
		return {
			currentPercent: 0,
			reservedPercent: 0,
			availablePercent: 0,
			reservedForOutput,
			availableSize,
		}
	}

	return {
		currentPercent: (safeContextTokens / total) * 100,
		reservedPercent: (reservedForOutput / total) * 100,
		availablePercent: (availableSize / total) * 100,
		reservedForOutput,
		availableSize,
	}
}
