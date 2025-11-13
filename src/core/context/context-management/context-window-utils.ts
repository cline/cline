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
	// New strategy: Use "75% OR 20K headroom" rule
	// Trigger when either condition is met (whichever comes first):
	// - 75% of context window is used, OR
	// - Only 20K tokens of headroom remaining
	const seventyFivePercent = Math.floor(contextWindow * 0.75)
	const twentyKHeadroom = contextWindow - 20_000
	maxAllowedSize = Math.min(seventyFivePercent, twentyKHeadroom)

	// Ensure we don't allow negative values for very small context windows
	maxAllowedSize = Math.max(maxAllowedSize, Math.floor(contextWindow * 0.6))

	return { contextWindow, maxAllowedSize }
}
