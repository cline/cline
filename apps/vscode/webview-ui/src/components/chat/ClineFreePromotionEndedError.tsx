import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useClineFreeModelSwitch } from "@/components/chat/useClineFreeModelSwitch"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Shown when a request targets a Cline free model whose promotion has ended.
 * Unlike the daily limit, waiting never helps — the model is gone — so the row
 * is a dead end unless it hands the user a new model to run on.
 */
const ClineFreePromotionEndedError = () => {
	const { navigateToSettingsModelPicker } = useExtensionState()
	const { paidModelId, isSwitching, didSwitch, switchError, switchToPaidModel } = useClineFreeModelSwitch()

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-free-promotion-ended-error">
			<div className="text-error mb-2">Free model promotion ended</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				The free promotion for this model has ended and it is no longer available.
			</div>
			{paidModelId ? (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2 wrap-anywhere">
					Switch to the paid version of this model ({paidModelId}) with usage-based billing, or select another model to
					continue.
				</div>
			) : (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2">Select another model to continue.</div>
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
