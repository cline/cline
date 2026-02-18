import type { ApiProvider } from "@shared/api"

const CLINE_FREE_MODEL_EXCEPTIONS = ["minimax-m2", "devstral-2512", "arcee-ai/trinity-large"]

export function isClineFreeModelException(modelId: string): boolean {
	const modelIdLower = modelId.toLowerCase()
	return CLINE_FREE_MODEL_EXCEPTIONS.some((token) => modelIdLower.includes(token))
}

/**
 * Filters OpenRouter model IDs based on provider-specific rules.
 * For Cline provider: excludes :free models (except known exception models)
 * For OpenRouter/Vercel: excludes cline/ prefixed models
 * @param modelIds Array of model IDs to filter
 * @param provider The current API provider
 * @param allowedFreeModelIds Optional list of Cline free model IDs to keep visible
 * @returns Filtered array of model IDs
 */
export function filterOpenRouterModelIds(
	modelIds: string[],
	provider: ApiProvider,
	allowedFreeModelIds: string[] = [],
): string[] {
	if (provider === "cline") {
		const allowedFreeIdSet = new Set(allowedFreeModelIds.map((id) => id.toLowerCase()))
		// For Cline provider: exclude :free models, but keep known exception models
		return modelIds.filter((id) => {
			if (allowedFreeIdSet.has(id.toLowerCase())) {
				return true
			}
			if (isClineFreeModelException(id)) {
				return true
			}
			// Filter out other :free models
			return !id.includes(":free")
		})
	}

	// For OpenRouter and Vercel AI Gateway providers: exclude Cline-specific models
	return modelIds.filter((id) => !id.startsWith("cline/"))
}
