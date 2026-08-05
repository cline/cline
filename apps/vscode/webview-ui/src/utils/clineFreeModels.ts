import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"

const CLINE_PROVIDER_ID = "cline"
const CLINE_PASS_PROVIDER_ID = "cline-pass"

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
