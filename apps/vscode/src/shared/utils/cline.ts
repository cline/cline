export const CLINE_PROVIDER_ID = "cline"
export const CLINE_PASS_PROVIDER_ID = "cline-pass"

export const CLINE_FREE_MODEL_PREFIX = "cline-free/"
export const CLINE_PASS_MODEL_PREFIX = "cline-pass/"

const CLINE_ROUTED_MODEL_PREFIXES = [CLINE_FREE_MODEL_PREFIX, CLINE_PASS_MODEL_PREFIX]

export function isClineManagedProvider(provider: string | undefined) {
	return provider === CLINE_PROVIDER_ID || provider === CLINE_PASS_PROVIDER_ID
}

function modelSlugOf(modelId: string): string {
	return modelId.split("/").at(-1) ?? modelId
}

function hasClineRoutedPrefix(modelId: string): boolean {
	return CLINE_ROUTED_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))
}

/**
 * `cline-free/<slug>` and `cline-pass/<slug>` are entitlement-gated routes for
 * models that also exist in the usage-billed Cline catalog under their lab
 * prefix (e.g. `cline-pass/deepseek-v4-flash` -> `deepseek/deepseek-v4-flash`).
 * Resolving that twin lets an entitlement or free-limit failure offer the same
 * model on usage-based billing instead of dead-ending on a paywall.
 */
export function findUsageBilledModelId(modelId: string | undefined, clineModelIds: string[]): string | undefined {
	if (!modelId || !hasClineRoutedPrefix(modelId)) {
		return undefined
	}

	const modelSlug = modelSlugOf(modelId)
	if (!modelSlug) {
		return undefined
	}

	return clineModelIds.find((candidateId) => !hasClineRoutedPrefix(candidateId) && modelSlugOf(candidateId) === modelSlug)
}
