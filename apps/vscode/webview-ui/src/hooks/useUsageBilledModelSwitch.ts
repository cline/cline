import { openAiModelInfoSafeDefaults } from "@shared/api"
import { CommitModelSelectionRequest } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { CLINE_PASS_PROVIDER_ID, CLINE_PROVIDER_ID, findUsageBilledModelId } from "@shared/utils/cline"
import { useMemo, useState } from "react"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient } from "@/services/grpc-client"

export interface UsageBilledModelSwitch {
	/** Usage-billed twin of the currently selected model, if the catalog has one. */
	targetModelId: string | undefined
	isSwitching: boolean
	didSwitch: boolean
	error: string | undefined
	switchToUsageBasedBilling: () => Promise<void>
}

/**
 * Moves the current mode off an entitlement-gated Cline route
 * (`cline-pass/<slug>` or `cline-free/<slug>`) and onto the usage-billed twin of
 * the same model on the Cline provider.
 *
 * `targetModelId` is latched once the switch succeeds: committing it rewrites
 * the same configuration this hook derives the target from, so without the
 * latch the caller would lose its target — and its "switched" confirmation —
 * the instant the write lands.
 */
export function useUsageBilledModelSwitch(): UsageBilledModelSwitch {
	const { apiConfiguration, mode } = useExtensionState()
	const { models: clineModels } = useProviderModels(CLINE_PROVIDER_ID)
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [isSwitching, setIsSwitching] = useState(false)
	const [switchedModelId, setSwitchedModelId] = useState<string | undefined>()
	const [error, setError] = useState<string | undefined>()

	const currentMode: Mode = mode ?? "act"
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	// A gated id normally lives under the cline-pass provider, but free ids and
	// hand-typed pass ids can also sit under the cline usage-billing provider.
	const selectedModelId =
		modeFields.apiProvider === CLINE_PASS_PROVIDER_ID
			? modeFields.clinePassModelId
			: modeFields.apiProvider === CLINE_PROVIDER_ID
				? modeFields.clineModelId
				: undefined
	const resolvedModelId = useMemo(
		() => findUsageBilledModelId(selectedModelId, Object.keys(clineModels ?? {})),
		[selectedModelId, clineModels],
	)
	const targetModelId = switchedModelId ?? resolvedModelId

	const switchToUsageBasedBilling = async () => {
		if (!resolvedModelId) {
			return
		}
		setIsSwitching(true)
		setError(undefined)
		try {
			const modelInfo = clineModels?.[resolvedModelId] ?? {
				...openAiModelInfoSafeDefaults,
				name: resolvedModelId,
			}

			await ModelsServiceClient.commitModelSelection(
				CommitModelSelectionRequest.create({
					providerId: CLINE_PROVIDER_ID,
					mode: currentMode,
					modelId: resolvedModelId,
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
					clineModelId: resolvedModelId,
					clineModelInfo: modelInfo,
				},
				currentMode,
			)
			setSwitchedModelId(resolvedModelId)
		} catch (err) {
			console.error("Failed to switch to Cline usage-based billing:", err)
			setError(`Failed to switch model. Select ${resolvedModelId} on Cline Usage-Billing in API Configuration settings.`)
		} finally {
			setIsSwitching(false)
		}
	}

	return {
		targetModelId,
		isSwitching,
		didSwitch: switchedModelId !== undefined,
		error,
		switchToUsageBasedBilling,
	}
}
