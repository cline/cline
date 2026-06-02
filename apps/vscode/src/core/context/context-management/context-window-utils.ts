import { ApiHandler } from "@core/api"

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	const model = api.getModel()
	const contextWindow = model.info.contextWindow || 128_000
	const isOpenAiCodexOAuth = model.providerId === "openai-codex"
	const defaultMaxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8)

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
		case 400_000:
			// OpenAI Codex OAuth has a 272K input cap inside the 400K total context window.
			maxAllowedSize = isOpenAiCodexOAuth ? 272_000 - 40_000 : defaultMaxAllowedSize
			break
		default:
			maxAllowedSize = defaultMaxAllowedSize // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
	}

	return { contextWindow, maxAllowedSize }
}
