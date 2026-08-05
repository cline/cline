import { openAiModelInfoSafeDefaults } from "@shared/api"
import { CommitModelSelectionRequest } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { useCallback, useMemo, useState } from "react"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient } from "@/services/grpc-client"

const CLINE_PROVIDER_ID = "cline"
const CLINE_FREE_MODEL_PREFIX = "cline-free/"

// Free model ids are cline-free/<model-slug>; their paid counterpart is the
// catalog model with the same slug under its lab prefix (e.g.
// cline-free/deepseek-v4-flash -> deepseek/deepseek-v4-flash).
export function findPaidModelId(freeModelId: string | undefined, clineModelIds: string[]): string | undefined {
	if (!freeModelId?.startsWith(CLINE_FREE_MODEL_PREFIX)) {
		return undefined
	}

	const modelSlug = freeModelId.slice(CLINE_FREE_MODEL_PREFIX.length)
	if (!modelSlug) {
		return undefined
	}

	return clineModelIds.find(
		(modelId) => !modelId.startsWith(CLINE_FREE_MODEL_PREFIX) && (modelId === modelSlug || modelId.endsWith(`/${modelSlug}`)),
	)
}

/**
 * Selection state shared by the chat rows that appear when a Cline free model
 * stops serving requests (daily limit reached, promotion ended): which free
 * model is configured, whether a paid twin exists, and the one-click switch to
 * it on Cline usage-based billing.
 */
export function useClineFreeModelSwitch() {
	const { apiConfiguration, mode } = useExtensionState()
	const { models: clineModels } = useProviderModels(CLINE_PROVIDER_ID)
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [switchError, setSwitchError] = useState<string | undefined>()

	const currentMode: Mode = mode ?? "act"
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	// Free models are selectable on both the cline and cline-pass providers, so
	// read the model id from whichever provider is currently selected.
	const freeModelId =
		modeFields.apiProvider === "cline-pass"
			? modeFields.clinePassModelId
			: modeFields.apiProvider === CLINE_PROVIDER_ID
				? modeFields.clineModelId
				: undefined
	const paidModelId = useMemo(() => findPaidModelId(freeModelId, Object.keys(clineModels ?? {})), [freeModelId, clineModels])

	const switchToPaidModel = useCallback(async () => {
		if (!paidModelId) {
			return
		}
		setIsSwitching(true)
		setSwitchError(undefined)
		try {
			const modelInfo = clineModels?.[paidModelId] ?? {
				...openAiModelInfoSafeDefaults,
				name: paidModelId,
			}

			await ModelsServiceClient.commitModelSelection(
				CommitModelSelectionRequest.create({
					providerId: CLINE_PROVIDER_ID,
					mode: currentMode,
					modelId: paidModelId,
				}),
			)

			await handleModeFieldsChange(
				{
					apiProvider: {
						plan: "planModeApiProvider",
						act: "actModeApiProvider",
					},
					clineModelId: {
						plan: "planModeClineModelId",
						act: "actModeClineModelId",
					},
					clineModelInfo: {
						plan: "planModeClineModelInfo",
						act: "actModeClineModelInfo",
					},
				},
				{
					apiProvider: CLINE_PROVIDER_ID,
					clineModelId: paidModelId,
					clineModelInfo: modelInfo,
				},
				currentMode,
			)
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to the paid model:", error)
			setSwitchError(`Failed to switch model. Select ${paidModelId} in API Configuration settings.`)
		} finally {
			setIsSwitching(false)
		}
	}, [clineModels, currentMode, handleModeFieldsChange, paidModelId])

	return { freeModelId, paidModelId, isSwitching, didSwitch, switchError, switchToPaidModel }
}
