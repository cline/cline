import type { ModelInfo } from "@shared/api"

/**
 * Cline free models are exposed by the recommended-models endpoint under a
 * dedicated namespace (for example `cline-free/deepseek-v4-flash`). They hit the
 * same Cline API as paid models but are always billed at $0, and they disappear
 * once their promotion ends.
 */
export const CLINE_FREE_MODEL_ID_PREFIX = "cline-free/"

const CLINE_FREE_MODEL_NAME_SUFFIX = " (free)"

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

export function isClineFreeModelId(modelId: string | undefined): boolean {
	return normalizeModelId(modelId ?? "").startsWith(CLINE_FREE_MODEL_ID_PREFIX)
}

/**
 * Returns the model slug of a `cline-free/` id (the part after the prefix), or
 * undefined when the id is not a Cline free model id.
 */
export function getClineFreeModelSlug(modelId: string | undefined): string | undefined {
	if (!isClineFreeModelId(modelId)) {
		return undefined
	}

	const modelSlug = (modelId as string).trim().slice(CLINE_FREE_MODEL_ID_PREFIX.length)
	return modelSlug.length > 0 ? modelSlug : undefined
}

/**
 * Free models are explicitly marked in the UI so users can tell them apart from
 * their paid counterparts, which share the same underlying model slug.
 */
export function formatClineFreeModelName(modelId: string, name?: string): string {
	const resolvedName = name?.trim() || modelId
	if (!isClineFreeModelId(modelId) || resolvedName.toLowerCase().endsWith(CLINE_FREE_MODEL_NAME_SUFFIX)) {
		return resolvedName
	}

	return `${resolvedName}${CLINE_FREE_MODEL_NAME_SUFFIX}`
}

/**
 * Free models ride usage billing at $0, so never display or accumulate cost for them.
 */
export function zeroPricedModelInfo(info: ModelInfo): ModelInfo {
	return {
		...info,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
	}
}

export function resolveClineFreeModelInfo(
	freeModelId: string | undefined,
	clineModels: Record<string, ModelInfo> | undefined | null,
): ModelInfo | undefined {
	if (!isClineFreeModelId(freeModelId) || !clineModels) {
		return undefined
	}

	const paidModelId = findPaidClineModelId(freeModelId, Object.keys(clineModels))
	const paidModelInfo = paidModelId ? clineModels[paidModelId] : undefined
	if (!paidModelInfo) {
		return undefined
	}

	return zeroPricedModelInfo({
		...paidModelInfo,
		name: formatClineFreeModelName(freeModelId as string, paidModelInfo.name),
	})
}

/**
 * Free model ids are `cline-free/<model-slug>`; their paid counterpart is the
 * catalog model with the same slug under its lab prefix (for example
 * `cline-free/deepseek-v4-flash` -> `deepseek/deepseek-v4-flash`).
 */
export function findPaidClineModelId(freeModelId: string | undefined, clineModelIds: string[]): string | undefined {
	const modelSlug = getClineFreeModelSlug(freeModelId)
	if (!modelSlug) {
		return undefined
	}

	const normalizedModelSlug = normalizeModelId(modelSlug)
	return clineModelIds.find((modelId) => {
		if (isClineFreeModelId(modelId)) {
			return false
		}

		const normalizedModelId = normalizeModelId(modelId)
		return normalizedModelId === normalizedModelSlug || normalizedModelId.endsWith(`/${normalizedModelSlug}`)
	})
}
