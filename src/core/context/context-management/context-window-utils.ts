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
	// FIXME: hack to get anyone using openai compatible with deepseek to have the proper context window instead of the default 128k. We need a way for the user to specify the context window for models they input through openai compatible

	// Handle special cases like DeepSeek
	if (api instanceof OpenAiHandler && api.getModel().id.toLowerCase().includes("deepseek")) {
		contextWindow = 128_000
	}

	let maxAllowedSize: number
	switch (contextWindow) {
		case 64_000: // deepseek models
			maxAllowedSize = contextWindow - 27_000
			break
		case 128_000: // most models
			maxAllowedSize = contextWindow - 30_000
			break
		case 200_000: // claude models
			maxAllowedSize = contextWindow - 40_000
			break
		default:
			maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
	}

	return { contextWindow, maxAllowedSize }
}

/**
 * Returns the effective compaction threshold in tokens, respecting a user-specified custom limit.
 *
 * When the user sets a custom token limit (autoCondenseTokenLimit), compaction triggers at
 * that limit rather than at the model's natural maximum. This allows users to compact earlier
 * to keep conversation context focused, particularly useful for large-context models where
 * the natural threshold (e.g. 750K on a 1M model) is impractically expensive.
 *
 * The custom limit is always capped by maxAllowedSize to preserve the safety buffer.
 *
 * @param api The API handler for the current model
 * @param customTokenLimit Optional user-configured token limit. When undefined, falls back to
 *   the model's natural maxAllowedSize.
 * @returns The effective threshold in tokens at which compaction should trigger
 */
export function getEffectiveCompactionThreshold(api: ApiHandler, customTokenLimit?: number): number {
	const { maxAllowedSize } = getContextWindowInfo(api)
	if (customTokenLimit !== undefined && customTokenLimit > 0) {
		return Math.min(customTokenLimit, maxAllowedSize)
	}
	return maxAllowedSize
}
