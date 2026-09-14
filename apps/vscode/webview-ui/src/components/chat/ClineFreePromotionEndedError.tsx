import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Shown when a request targets a retired cline-free/ model: once its free
// promotion ends the model is removed from the catalog and the backend answers
// "model not found". Mirrors the CLI's "Free model promotion ended" banner,
// with the CLI's "/model" hint replaced by a button into the model picker.
const ClineFreePromotionEndedError = () => {
	const { t } = useTranslation()
	const { navigateToSettingsModelPicker } = useExtensionState()

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-free-promotion-ended-error">
			<div className="text-error mb-2">{t("chat:errors.freePromotionEnded.title")}</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				{t("chat:errors.freePromotionEnded.body")}
			</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
				{t("chat:errors.freePromotionEnded.selectAnother")}
			</div>
			<VSCodeButton
				appearance="primary"
				className="w-full mt-3"
				onClick={() => navigateToSettingsModelPicker({ targetSection: "api-config" })}>
				{t("chat:errors.freePromotionEnded.selectModel")}
			</VSCodeButton>
		</div>
	)
}

export default ClineFreePromotionEndedError
