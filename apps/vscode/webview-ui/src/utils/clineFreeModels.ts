import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"

export const CLINE_PROVIDER_ID = "cline"
export const CLINE_PASS_PROVIDER_ID = "cline-pass"
export const CLINE_FREE_MODEL_PREFIX = "cline-free/"

export function isClineFreeModelId(modelId: string | undefined): boolean {
	return modelId?.startsWith(CLINE_FREE_MODEL_PREFIX) ?? false
}

/**
 * The model id selected for `mode`, when the active provider is one of the two
 * that serve Cline free models. Free models are selectable on both the cline
 * and cline-pass providers, so read the id from whichever one is selected.
 */
export function getSelectedClineModelId(apiConfiguration: ApiConfiguration | undefined, mode: Mode): string | undefined {
	const modeFields = getModeSpecificFields(apiConfiguration, mode)
	if (modeFields.apiProvider === CLINE_PASS_PROVIDER_ID) {
		return modeFields.clinePassModelId
	}
	if (modeFields.apiProvider === CLINE_PROVIDER_ID) {
		return modeFields.clineModelId
	}
	return undefined
}

/**
 * Free model ids are cline-free/<model-slug>; their paid counterpart is the
 * catalog model with the same slug under its lab prefix (e.g.
 * cline-free/deepseek-v4-flash -> deepseek/deepseek-v4-flash).
 */
export function findPaidModelId(freeModelId: string | undefined, clineModelIds: string[]): string | undefined {
	if (!isClineFreeModelId(freeModelId)) {
		return undefined
	}

	const modelSlug = freeModelId?.slice(CLINE_FREE_MODEL_PREFIX.length)
	if (!modelSlug) {
		return undefined
	}

	return clineModelIds.find(
		(modelId) => !isClineFreeModelId(modelId) && (modelId === modelSlug || modelId.endsWith(`/${modelSlug}`)),
	)
}

/**
 * Human-readable label for a free model id, used when the model has already
 * been pulled from the catalog and no display name is available anymore.
 */
export function getFreeModelLabel(freeModelId: string | undefined): string | undefined {
	if (!isClineFreeModelId(freeModelId)) {
		return undefined
	}
	return freeModelId?.slice(CLINE_FREE_MODEL_PREFIX.length) || undefined
}
