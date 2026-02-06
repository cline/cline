/**
 * Context Window Utilities for the Webview UI
 *
 * Provides validation and helper functions for context window configuration.
 */

/**
 * Validates a context window value
 */
export interface ContextWindowValidationResult {
	valid: boolean
	warning?: string
	error?: string
}

/**
 * Validates a context window value
 *
 * @param contextWindow - The context window value to validate
 * @param maxOutputTokens - Optional max output tokens to check against
 * @returns Validation result with any warnings or errors
 */
export function validateContextWindow(contextWindow: number | string, maxOutputTokens?: number): ContextWindowValidationResult {
	// Handle string input (from text fields)
	const numValue = typeof contextWindow === "string" ? parseInt(contextWindow, 10) : contextWindow

	// Check if it's a valid number
	if (isNaN(numValue)) {
		return {
			valid: false,
			error: "Please enter a valid number",
		}
	}

	// Check minimum value
	if (numValue < 1_000) {
		return {
			valid: false,
			error: "Context window must be at least 1,000 tokens",
		}
	}

	// Check maximum value
	if (numValue > 10_000_000) {
		return {
			valid: false,
			error: "Context window exceeds maximum recommended value (10M tokens)",
		}
	}

	// Check if max output tokens exceeds context window
	if (maxOutputTokens && maxOutputTokens >= numValue) {
		return {
			valid: false,
			error: "Max output tokens cannot exceed context window",
		}
	}

	// Check for potentially problematic values
	if (numValue < 32_000 && numValue > 1_000) {
		return {
			valid: true,
			warning: "Small context window may limit functionality with large projects",
		}
	}

	return { valid: true }
}

/**
 * Common context window presets for quick selection
 */
export const CONTEXT_WINDOW_PRESETS = [
	{ label: "32K", value: 32_000 },
	{ label: "64K", value: 64_000 },
	{ label: "128K", value: 128_000, default: true },
	{ label: "200K", value: 200_000 },
	{ label: "512K", value: 512_000 },
	{ label: "1M", value: 1_000_000 },
] as const

export type ContextWindowPreset = (typeof CONTEXT_WINDOW_PRESETS)[number]["value"]

/**
 * Finds the closest preset value to a given context window
 */
export function findClosestPreset(contextWindow: number): ContextWindowPreset | null {
	let closest: ContextWindowPreset | null = null
	let closestDiff = Infinity

	for (const preset of CONTEXT_WINDOW_PRESETS) {
		const diff = Math.abs(contextWindow - preset.value)
		if (diff < closestDiff) {
			closestDiff = diff
			closest = preset.value
		}
	}

	return closest
}

/**
 * Checks if a context window value matches a preset
 */
export function isPresetValue(contextWindow: number): boolean {
	return CONTEXT_WINDOW_PRESETS.some((preset) => preset.value === contextWindow)
}

/**
 * Formats a context window value for display
 */
export function formatContextWindow(contextWindow: number): string {
	if (contextWindow >= 1_000_000) {
		return `${(contextWindow / 1_000_000).toFixed(1)}M`
	}
	if (contextWindow >= 1_000) {
		return `${contextWindow / 1_000}K`
	}
	return contextWindow.toString()
}

/**
 * Parses a context window value from user input
 */
export function parseContextWindowInput(input: string): number | null {
	// Handle common formats
	const normalizedInput = input.toLowerCase().trim()

	// Handle "1m" or "1M" format
	if (normalizedInput.endsWith("m")) {
		const value = parseFloat(normalizedInput.slice(0, -1))
		if (!isNaN(value)) {
			return Math.round(value * 1_000_000)
		}
	}

	// Handle "128k" or "128K" format
	if (normalizedInput.endsWith("k")) {
		const value = parseFloat(normalizedInput.slice(0, -1))
		if (!isNaN(value)) {
			return Math.round(value * 1_000)
		}
	}

	// Handle plain numbers
	const value = parseInt(input, 10)
	if (!isNaN(value) && value > 0) {
		return value
	}

	return null
}

/**
 * Estimates the typical prompt size used by Cline
 * This includes system prompt, common context, and buffer
 */
export function getEstimatedPromptOverhead(contextWindow: number): {
	overhead: number
	percentage: number
} {
	let overhead: number

	if (contextWindow <= 64_000) {
		overhead = 27_000
	} else if (contextWindow <= 128_000) {
		overhead = 30_000
	} else if (contextWindow <= 200_000) {
		overhead = 40_000
	} else if (contextWindow <= 1_000_000) {
		overhead = 60_000
	} else {
		overhead = 100_000
	}

	return {
		overhead,
		percentage: Math.round((overhead / contextWindow) * 100),
	}
}

/**
 * Gets the available context for user content
 */
export function getAvailableContext(contextWindow: number): number {
	const { overhead } = getEstimatedPromptOverhead(contextWindow)
	return contextWindow - overhead
}

/**
 * Determines if a context window warning should be shown
 */
export function shouldShowContextWarning(
	contextWindow: number,
	estimatedContextUsage: number,
): { show: boolean; type: "warning" | "danger" | "info"; message: string } {
	const available = getAvailableContext(contextWindow)
	const usagePercentage = (estimatedContextUsage / available) * 100

	if (usagePercentage > 100) {
		return {
			show: true,
			type: "danger",
			message: "Your prompt exceeds the available context. Consider reducing context.",
		}
	}

	if (usagePercentage > 85) {
		return {
			show: true,
			type: "warning",
			message: `High context usage (${Math.round(usagePercentage)}%). Consider reducing context if you encounter issues.`,
		}
	}

	if (usagePercentage > 70) {
		return {
			show: true,
			type: "info",
			message: `Moderate context usage (${Math.round(usagePercentage)}%).`,
		}
	}

	return {
		show: false,
		type: "info",
		message: "",
	}
}

/**
 * Common model context window reference values
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
	// OpenAI
	"gpt-4o": 128_000,
	"gpt-4o-mini": 128_000,
	"gpt-4-turbo": 128_000,
	"gpt-4": 8_192,
	"gpt-3.5-turbo": 16_385,
	// Anthropic
	"claude-opus-4": 200_000,
	"claude-sonnet-4": 200_000,
	"claude-haiku-3-5": 200_000,
	"claude-3-5-sonnet": 200_000,
	"claude-3-opus": 200_000,
	"claude-3-sonnet": 200_000,
	"claude-3-haiku": 200_000,
	// DeepSeek
	"deepseek-chat": 128_000,
	"deepseek-reasoner": 128_000,
	"deepseek-r1": 64_000,
	// Google
	"gemini-1.5-pro": 1_048_576,
	"gemini-1.5-flash": 1_048_576,
	"gemini-1.0-pro": 32_000,
	// Meta
	"llama-3.1-405b": 128_000,
	"llama-3.1-70b": 128_000,
	"llama-3.1-8b": 128_000,
	"llama-3-70b": 8_192,
	"llama-3-8b": 8_192,
}

/**
 * Gets the known context window for a model ID
 */
export function getKnownModelContextWindow(modelId: string): number | null {
	const normalizedId = modelId.toLowerCase()

	for (const [pattern, contextWindow] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
		if (normalizedId.includes(pattern)) {
			return contextWindow
		}
	}

	return null
}
