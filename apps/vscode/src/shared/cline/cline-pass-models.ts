/**
 * ClinePass models are exposed under a dedicated namespace (for example
 * `cline-pass/deepseek-v4-flash`). The Cline API gates that namespace on an
 * active ClinePass subscription, but every ClinePass model is also served
 * through usage-based billing under its lab-prefixed id
 * (`deepseek/deepseek-v4-flash`), so a user without the subscription can still
 * run the same model by switching to the `cline` provider.
 */
export const CLINE_PASS_MODEL_ID_PREFIX = "cline-pass/"

// Promotional free ids share their slug with the paid catalog entry, so they must
// be skipped when resolving the usage-billed counterpart of a ClinePass model.
const CLINE_FREE_MODEL_ID_PREFIX = "cline-free/"

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

export function isClinePassModelId(modelId: string | undefined): boolean {
	return normalizeModelId(modelId ?? "").startsWith(CLINE_PASS_MODEL_ID_PREFIX)
}

/**
 * Returns the model slug of a `cline-pass/` id (the part after the prefix), or
 * undefined when the id is not a ClinePass model id.
 */
export function getClinePassModelSlug(modelId: string | undefined): string | undefined {
	if (!isClinePassModelId(modelId)) {
		return undefined
	}

	const modelSlug = (modelId as string).trim().slice(CLINE_PASS_MODEL_ID_PREFIX.length)
	return modelSlug.length > 0 ? modelSlug : undefined
}

/**
 * Resolves the usage-billed counterpart of a ClinePass model: the catalog model
 * carrying the same slug under its lab prefix (for example
 * `cline-pass/glm-5.2` -> `z-ai/glm-5.2`).
 */
export function findUsageBasedClineModelId(clinePassModelId: string | undefined, clineModelIds: string[]): string | undefined {
	const modelSlug = getClinePassModelSlug(clinePassModelId)
	if (!modelSlug) {
		return undefined
	}

	const normalizedModelSlug = normalizeModelId(modelSlug)
	return clineModelIds.find((modelId) => {
		const normalizedModelId = normalizeModelId(modelId)
		if (
			normalizedModelId.startsWith(CLINE_PASS_MODEL_ID_PREFIX) ||
			normalizedModelId.startsWith(CLINE_FREE_MODEL_ID_PREFIX)
		) {
			return false
		}

		return normalizedModelId === normalizedModelSlug || normalizedModelId.endsWith(`/${normalizedModelSlug}`)
	})
}
