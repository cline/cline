import { openRouterDefaultModelInfo } from "@shared/api"
import { findPaidClineModelId } from "@shared/cline/free-models"
import type { Mode } from "@shared/storage/types"
import { useMemo, useState } from "react"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

const CLINE_PROVIDER_ID = "cline"

/**
 * Moves the selection from a Cline free model to its usage-billed twin on the
 * cline provider. Shared by the free-model error cards, which both need the
 * same "the free tier is gone, here is the paid same-model" escape hatch.
 */
export function useSwitchToPaidClineModel(freeModelId: string | undefined) {
	const { mode, clineModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [switchError, setSwitchError] = useState<string | undefined>()

	const currentMode: Mode = mode ?? "act"
	const paidModelId = useMemo(
		() => findPaidClineModelId(freeModelId, Object.keys(clineModels ?? {})),
		[freeModelId, clineModels],
	)

	const switchToPaidModel = async () => {
		if (!paidModelId) {
			return
		}
		setIsSwitching(true)
		setSwitchError(undefined)
		try {
			const modelInfo = clineModels?.[paidModelId] ?? {
				...openRouterDefaultModelInfo,
				name: paidModelId,
			}

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
	}

	return { paidModelId, isSwitching, didSwitch, switchError, switchToPaidModel }
}
