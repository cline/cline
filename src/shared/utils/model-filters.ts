import type { ApiProvider } from "@shared/api"

const MODEL_ID_CANONICAL_ALIASES: Record<string, string> = {
	"anthropic/claude-4.6-sonnet": "anthropic/claude-sonnet-4.6",
	"anthropic/claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
	"anthropic/claude-4.5-sonnet": "anthropic/claude-sonnet-4.5",
	"anthropic/claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
}

export function normalizeModelIdForComparison(modelId: string): string {
	const normalized = modelId.trim().toLowerCase()
	return MODEL_ID_CANONICAL_ALIASES[normalized] ?? normalized
}

const CLINE_FREE_MODEL_EXCEPTIONS = ["minimax-m2", "devstral-2512", "arcee-ai/trinity-large"]

export function isClineFreeModelException(modelId: string): boolean {
	const normalizedModelId = normalizeModelIdForComparison(modelId)
	return CLINE_FREE_MODEL_EXCEPTIONS.some((token) => normalizedModelId.includes(token))
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
		const allowedFreeIdSet = new Set(allowedFreeModelIds.map((id) => normalizeModelIdForComparison(id)))
		// For Cline provider: exclude :free models, but keep known exception models
		return modelIds.filter((id) => {
			const normalizedModelId = normalizeModelIdForComparison(id)
			if (allowedFreeIdSet.has(normalizedModelId)) {
				return true
			}
			if (isClineFreeModelException(normalizedModelId)) {
				return true
			}
			// Filter out other :free models
			return !normalizedModelId.includes(":free")
		})
	}

	// For OpenRouter and Vercel AI Gateway providers: exclude Cline-specific models
	return modelIds.filter((id) => !id.startsWith("cline/"))
}
