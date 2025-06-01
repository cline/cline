import { anthropicModels } from "@shared/api"

/**
 * Validates the thinking budget token value according to the specified rules:
 * - If disabled (0), return as is
 * - If enabled but less than minimum (1024), set to minimum
 * - If greater than or equal to max tokens, set to max tokens - 1
 * - Otherwise, return the original value
 *
 * @param value The thinking budget token value to validate
 * @param maxTokens The maximum tokens for the current model
 * @returns The validated thinking budget token value
 */
export function validateThinkingBudget(
	value: number,
	maxTokens: number = anthropicModels["claude-3-7-sonnet-20250219"].maxTokens,
): number {
	// If disabled (0), return as is
	if (value === 0) {
		return 0
	}

	// If enabled but less than minimum, set to minimum
	if (value > 0 && value < 1024) {
		return 1024
	}

	// If greater than or equal to max allowed tokens (80% of max tokens), cap at that value
	const maxAllowedTokens = Math.floor(maxTokens * 0.8)
	if (value >= maxAllowedTokens) {
		return maxAllowedTokens
	}

	// Otherwise, return the original value
	return value
}
