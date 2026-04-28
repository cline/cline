import { ApiHandler } from "@core/api"
import { OpenAiHandler } from "@core/api/providers/openai"

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	let contextWindow = api.getModel().info.contextWindow || 128_000

	// Handle OpenAiHandler with deepseek models — use actual model info when available
	// to avoid forcing 128K on models with different context windows (e.g., v4-pro 1M).
	if (api instanceof OpenAiHandler && api.getModel().id.toLowerCase().includes("deepseek")) {
		contextWindow = api.getModel().info.contextWindow || 128_000
	}

	let maxAllowedSize: number
	// Dynamic buffer sizing based on context window tiers.
	// Small windows need proportionally larger buffers for output tokens;
	// large windows (e.g., deepseek-v4-pro 1M) can use a smaller relative buffer.
	if (contextWindow <= 64_000) {
		// deepseek-v4-flash and similar small models: reserve ~42% for output
		maxAllowedSize = contextWindow - 27_000
	} else if (contextWindow <= 128_000) {
		// deepseek-chat, deepseek-reasoner, and most 128K models: reserve ~23%
		maxAllowedSize = contextWindow - 30_000
	} else if (contextWindow <= 200_000) {
		// Claude models: reserve 20%
		maxAllowedSize = contextWindow - 40_000
	} else if (contextWindow <= 500_000) {
		// Mid-large windows: reserve 100K (conservative)
		maxAllowedSize = contextWindow - 100_000
	} else {
		// Extra-large windows (deepseek-v4-pro 1M, etc.): reserve 60K
		// 384K maxTokens output ceiling far exceeds the 60K buffer requirement,
		// so we can safely use a smaller buffer to maximize available input context.
		maxAllowedSize = Math.max(contextWindow - 60_000, contextWindow * 0.94)
	}

	return { contextWindow, maxAllowedSize }
}
