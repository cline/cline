import { ApiHandler } from "@api/index"
import { OpenAiHandler } from "@api/providers/openai"

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
		contextWindow = 64_000
	}

	let maxAllowedSize: number
	switch (contextWindow) {
		case 64_000: // deepseek models
			maxAllowedSize = contextWindow - 27_000
			break
		case 80_000: // claude via vscode-lm (claude-sonnet-4, claude-opus-4)
			maxAllowedSize = contextWindow - 30_000
			break
		case 90_000: // claude-3.5-sonnet via vscode-lm
			maxAllowedSize = contextWindow - 30_000
			break
		case 106_384: // claude-3.7-sonnet via vscode-lm
			maxAllowedSize = contextWindow - 35_000
			break
		case 128_000: // most models
			maxAllowedSize = contextWindow - 30_000
			break
		case 200_000: // claude models (direct)
			maxAllowedSize = contextWindow - 40_000
			break
		default:
			maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
	}

	return { contextWindow, maxAllowedSize }
}
