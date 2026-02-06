import { ApiHandler } from "@core/api"
import { OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"

/**
 * Gets context window information for the given API handler
 *
 * Context window resolution priority:
 * 1. User-configured context window (if different from default)
 * 2. Provider-detected context window from model info
 * 3. Provider-specific defaults (DeepSeek, etc.)
 * 4. Fallback default (128K)
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	const modelInfo = api.getModel().info
	const providerContextWindow = modelInfo.contextWindow

	// Determine the context window with proper priority
	let contextWindow: number

	if (providerContextWindow !== undefined && providerContextWindow !== null) {
		// Check if user has configured a non-default context window
		// We detect user configuration by checking if the value differs from the sane defaults
		// This is a heuristic - ideally we would have a separate field to track user overrides
		if ("isR1FormatRequired" in modelInfo || "temperature" in modelInfo) {
			// For OpenAI-compatible models, check if this looks like a user-configured value
			// by comparing against the sane defaults
			if (providerContextWindow !== openAiModelInfoSaneDefaults.contextWindow) {
				// User has explicitly configured a different context window
				contextWindow = providerContextWindow
			} else {
				// This is the default value - check if we have provider-specific defaults
				contextWindow = getProviderDefaultContextWindow(api)
			}
		} else {
			// For known providers with built-in model definitions
			contextWindow = providerContextWindow
		}
	} else {
		// No context window info available - use provider-specific defaults
		contextWindow = getProviderDefaultContextWindow(api)
	}

	// Calculate max allowed size based on context window
	const maxAllowedSize = calculateMaxAllowedSize(contextWindow)

	return { contextWindow, maxAllowedSize }
}

/**
 * Gets the provider-specific default context window for models
 * that don't have explicit context window configuration
 */
function getProviderDefaultContextWindow(api: ApiHandler): number {
	const modelId = api.getModel().id.toLowerCase()

	// DeepSeek models
	if (modelId.includes("deepseek")) {
		// Check for reasoning model (64K context) vs chat model (128K context)
		if (modelId.includes("reasoner") || modelId.includes("r1")) {
			return 64_000
		}
		return 128_000
	}

	// Default fallback
	return 128_000
}

/**
 * Calculates the maximum allowed context size for a given context window
 *
 * This accounts for:
 * - System prompt overhead
 * - Response buffer for model outputs
 * - Provider-specific requirements (Claude needs more buffer)
 *
 * @param contextWindow The total context window size in tokens
 * @returns The maximum allowed size for user content
 */
export function calculateMaxAllowedSize(contextWindow: number): number {
	switch (contextWindow) {
		case 64_000: {
			// Smaller context models need more aggressive buffering
			// 27K buffer leaves ~37K for user content
			return contextWindow - 27_000
		}
		case 128_000: {
			// Standard context for most models
			// 30K buffer leaves ~98K for user content
			return contextWindow - 30_000
		}
		case 200_000: {
			// Claude models need larger buffers for system prompts
			// 40K buffer leaves ~160K for user content
			return contextWindow - 40_000
		}
		case 1_000_000:
		case 1_048_576: {
			// Gemini 1.5 Pro/Flash with 1M context
			// Larger buffer for extensive system prompts
			return contextWindow - 100_000
		}
		default: {
			// For custom/unknown context window sizes
			// Use 80% as baseline, but ensure at least 40K buffer
			// This prevents issues with small context models (like DeepSeek R1's 64K)
			const calculatedBuffer = Math.max(contextWindow * 0.2, 40_000)
			return Math.floor(contextWindow - calculatedBuffer)
		}
	}
}

/**
 * Updates the context window for a model configuration
 * Used when user changes context window in settings
 */
export function updateModelContextWindow(
	currentModelInfo: OpenAiCompatibleModelInfo,
	newContextWindow: number,
): OpenAiCompatibleModelInfo {
	return {
		...currentModelInfo,
		contextWindow: newContextWindow,
	}
}

/**
 * Validates context window configuration
 * Returns validation result with any warnings
 */
export function validateContextWindow(contextWindow: number, maxOutputTokens?: number): { valid: boolean; warning?: string } {
	if (contextWindow < 1_000) {
		return { valid: false, warning: "Context window must be at least 1,000 tokens" }
	}
	if (contextWindow > 10_000_000) {
		return { valid: false, warning: "Context window exceeds maximum recommended value (10M tokens)" }
	}
	if (maxOutputTokens && maxOutputTokens >= contextWindow) {
		return { valid: false, warning: "Max output tokens cannot exceed context window" }
	}
	return { valid: true }
}

/**
 * Common context window presets for quick selection
 */
export const CONTEXT_WINDOW_PRESETS = [
	{ label: "32K", value: 32_000 },
	{ label: "64K", value: 64_000 },
	{ label: "128K", value: 128_000 },
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
