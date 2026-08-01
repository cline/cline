/**
 * Cline exposes some models under synthetic id namespaces:
 *
 * - `cline-pass/<slug>` — gated on an active ClinePass subscription
 * - `cline-free/<slug>` — promotional, always billed at $0
 *
 * Both namespaces serve the same underlying models the catalog offers through
 * usage-based billing under lab-prefixed ids (for example
 * `deepseek/deepseek-v4-flash`), so a user blocked on a synthetic id can always
 * run the same model by switching to its usage-billed counterpart.
 */
export const CLINE_PASS_MODEL_ID_PREFIX = "cline-pass/"
export const CLINE_FREE_MODEL_ID_PREFIX = "cline-free/"

const CLINE_SYNTHETIC_MODEL_ID_PREFIXES = [CLINE_PASS_MODEL_ID_PREFIX, CLINE_FREE_MODEL_ID_PREFIX] as const

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

function getSyntheticPrefix(modelId: string | undefined): string | undefined {
	const normalizedModelId = normalizeModelId(modelId ?? "")
	return CLINE_SYNTHETIC_MODEL_ID_PREFIXES.find((prefix) => normalizedModelId.startsWith(prefix))
}

export function isClinePassModelId(modelId: string | undefined): boolean {
	return getSyntheticPrefix(modelId) === CLINE_PASS_MODEL_ID_PREFIX
}

export function isClineFreeModelId(modelId: string | undefined): boolean {
	return getSyntheticPrefix(modelId) === CLINE_FREE_MODEL_ID_PREFIX
}

/**
 * Returns the model slug of a synthetic Cline id (the part after the
 * `cline-pass/` or `cline-free/` prefix), or undefined for any other id.
 */
export function getSyntheticClineModelSlug(modelId: string | undefined): string | undefined {
	const prefix = getSyntheticPrefix(modelId)
	if (!prefix) {
		return undefined
	}

	const modelSlug = (modelId as string).trim().slice(prefix.length)
	return modelSlug.length > 0 ? modelSlug : undefined
}

/**
 * Resolves the usage-billed counterpart of a synthetic Cline model id: the
 * catalog model carrying the same slug under its lab prefix (for example
 * `cline-pass/glm-5.2` -> `z-ai/glm-5.2`, `cline-free/deepseek-v4-flash` ->
 * `deepseek/deepseek-v4-flash`). Other synthetic ids share the slug, so they
 * are never returned as the counterpart.
 */
export function findUsageBasedClineModelId(modelId: string | undefined, clineModelIds: string[]): string | undefined {
	const modelSlug = getSyntheticClineModelSlug(modelId)
	if (!modelSlug) {
		return undefined
	}

	const normalizedModelSlug = normalizeModelId(modelSlug)
	return clineModelIds.find((candidateModelId) => {
		if (getSyntheticPrefix(candidateModelId)) {
			return false
		}

		const normalizedCandidateId = normalizeModelId(candidateModelId)
		return normalizedCandidateId === normalizedModelSlug || normalizedCandidateId.endsWith(`/${normalizedModelSlug}`)
	})
}
