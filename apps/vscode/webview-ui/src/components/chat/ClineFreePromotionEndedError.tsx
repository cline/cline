import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Shown when a request targets a retired cline-free/ model: the backend answers
// "model not found" once its free promotion ends and the model is removed from
// the catalog. Mirrors the CLI's "Free model promotion ended" banner, replacing
// the CLI's "/model" hint with a button that opens the model picker.
const ClineFreePromotionEndedError = () => {
	const { navigateToSettingsModelPicker } = useExtensionState()

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-free-promotion-ended-error">
			<div className="text-error mb-2">Free model promotion ended</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				The free promotion for this model has ended and it is no longer available.
			</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">Select another model to continue.</div>
			<VSCodeButton
				appearance="primary"
				className="w-full mt-3"
				onClick={() => navigateToSettingsModelPicker({ targetSection: "api-config" })}>
				Select a Model
			</VSCodeButton>
		</div>
	)
}

export default ClineFreePromotionEndedError
