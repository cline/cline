import { openAiModelInfoSafeDefaults } from "@shared/api"
import { CommitModelSelectionRequest } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient } from "@/services/grpc-client"

interface ClineFreeModelLimitErrorProps {
	message: string
}

const CLINE_PROVIDER_ID = "cline"
const CLINE_FREE_MODEL_PREFIX = "cline-free/"
const FREE_MODEL_LIMIT_RETRY_MARKER = "try again in "

function extractFreeModelLimitResetTime(message: string): string | undefined {
	const backendMessage = message.toLowerCase()
	const resetStart = backendMessage.indexOf(FREE_MODEL_LIMIT_RETRY_MARKER)
	if (resetStart === -1) {
		return undefined
	}

	const resetTime = backendMessage.slice(resetStart + FREE_MODEL_LIMIT_RETRY_MARKER.length).trim()
	return resetTime || undefined
}

// Free model ids are cline-free/<model-slug>; their paid counterpart is the
// catalog model with the same slug under its lab prefix (e.g.
// cline-free/deepseek-v4-flash -> deepseek/deepseek-v4-flash).
function findPaidModelId(freeModelId: string | undefined, clineModelIds: string[]): string | undefined {
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

const ClineFreeModelLimitError = ({ message }: ClineFreeModelLimitErrorProps) => {
	const { t } = useTranslation()
	const { apiConfiguration, mode } = useExtensionState()
	const { models: clineModels } = useProviderModels(CLINE_PROVIDER_ID)
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [switchError, setSwitchError] = useState<string | undefined>()

	const resetTime = extractFreeModelLimitResetTime(message)
	const currentMode: Mode = mode ?? "act"
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	// Free models are selectable on both the cline and cline-pass providers, so
	// read the model id from whichever provider is currently selected.
	const selectedFreeModelId =
		modeFields.apiProvider === "cline-pass"
			? modeFields.clinePassModelId
			: modeFields.apiProvider === CLINE_PROVIDER_ID
				? modeFields.clineModelId
				: undefined
	const paidModelId = useMemo(
		() => findPaidModelId(selectedFreeModelId, Object.keys(clineModels ?? {})),
		[selectedFreeModelId, clineModels],
	)

	const handleSwitchToPaidModel = async () => {
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
			setSwitchError(t("chat:errors.freeModelLimit.switchFailed", { modelId: paidModelId }))
		} finally {
			setIsSwitching(false)
		}
	}

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-free-model-limit-error">
			<div className="text-error mb-2">{t("chat:errors.freeModelLimit.limitReached")}</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				{t("chat:errors.freeModelLimit.limitBody")}
			</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
				{resetTime
					? t("chat:errors.freeModelLimit.tryAgainIn", { resetTime })
					: t("chat:errors.freeModelLimit.tryAgainLater")}
			</div>
			{paidModelId && (
				<>
					<div className="text-(--vscode-descriptionForeground) text-xs mt-2 wrap-anywhere">
						{t("chat:errors.freeModelLimit.switchPaid", { modelId: paidModelId })}
					</div>
					<VSCodeButton
						appearance="primary"
						className="w-full mt-3"
						disabled={isSwitching || didSwitch}
						onClick={handleSwitchToPaidModel}>
						{isSwitching
							? t("chat:errors.billing.switching")
							: didSwitch
								? t("chat:errors.billing.switchedToUsageBased")
								: t("chat:errors.billing.switchToUsageBased")}
					</VSCodeButton>
					{didSwitch && (
						<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
							{t("chat:errors.billing.retryAfterSwitching")}
						</div>
					)}
					{switchError && <div className="text-error text-xs mt-2">{switchError}</div>}
				</>
			)}
		</div>
	)
}

export default ClineFreeModelLimitError
