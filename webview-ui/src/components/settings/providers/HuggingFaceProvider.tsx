import { Mode } from "@shared/storage/types"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { HuggingFaceModelPicker } from "../HuggingFaceModelPicker"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the HuggingFaceProvider component
 */
interface HuggingFaceProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Hugging Face provider configuration component
 */
export const HuggingFaceProvider = ({ showModelOptions, isPopup, currentMode }: HuggingFaceProviderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.huggingFaceApiKey || ""}
				onChange={(value) => handleFieldChange("huggingFaceApiKey", value)}
				placeholder={t("providers.enterApiKey")}
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>Hugging Face {t("providers.apiKey")}</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("providers.huggingFaceKeyDescription")}{" "}
				<a href="https://huggingface.co/settings/tokens" rel="noopener noreferrer" target="_blank">
					{t("providers.huggingFaceGetApiKey")}
				</a>
			</p>

			{showModelOptions && <HuggingFaceModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
