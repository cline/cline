import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSwitchToPaidClineModel } from "@/hooks/useSwitchToPaidClineModel"
import { getFreeModelLabel } from "@/utils/clineFreeModels"

interface ClineFreePromotionEndedErrorProps {
	/** The retired cline-free/<slug> model still selected for the current mode. */
	modelId?: string
}

/**
 * Shown when a free model promotion ends: the cline-free/ id is pulled from the
 * catalog and the API answers model-not-found. Unlike the daily limit there is
 * nothing to wait for, so the card only offers ways off the model.
 */
const ClineFreePromotionEndedError = ({ modelId }: ClineFreePromotionEndedErrorProps) => {
	const { navigateToSettingsModelPicker } = useExtensionState()
	const { paidModelId, isSwitching, didSwitch, switchError, switchToPaidModel } = useSwitchToPaidClineModel(modelId)

	const modelLabel = getFreeModelLabel(modelId)

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-free-promotion-ended-error">
			<div className="text-error mb-2">Free model promotion ended</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				The free promotion for {modelLabel ?? "this model"} has ended and it is no longer available.
			</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">Select another model to continue.</div>
			{paidModelId && (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2 wrap-anywhere">
					You can keep using the same model ({paidModelId}) with usage-based billing.
				</div>
			)}
			{paidModelId && (
				<VSCodeButton
					appearance="primary"
					className="w-full mt-3"
					disabled={isSwitching || didSwitch}
					onClick={switchToPaidModel}>
					{isSwitching
						? "Switching..."
						: didSwitch
							? "Switched to Usage-Based billing"
							: "Switch to Usage-Based billing"}
				</VSCodeButton>
			)}
			<VSCodeButton
				appearance={paidModelId ? "secondary" : "primary"}
				className="w-full mt-2"
				onClick={() => navigateToSettingsModelPicker({ targetSection: "api-config" })}>
				Choose another model
			</VSCodeButton>
			{didSwitch && (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2">Retry the request after switching.</div>
			)}
			{switchError && <div className="text-error text-xs mt-2">{switchError}</div>}
		</div>
	)
}

export default ClineFreePromotionEndedError
