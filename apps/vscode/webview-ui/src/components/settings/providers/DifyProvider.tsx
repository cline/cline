import { Mode } from "@shared/storage/types"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDebouncedInput } from "../utils/useDebouncedInput"

interface DifyProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const DifyProvider = ({ showModelOptions, isPopup, currentMode }: DifyProviderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Use debounced input for proper state management
	const [baseUrlValue, setBaseUrlValue] = useDebouncedInput(apiConfiguration?.difyBaseUrl || "", (value) =>
		handleFieldChange("difyBaseUrl", value),
	)

	const [apiKeyValue, setApiKeyValue] = useDebouncedInput(apiConfiguration?.difyApiKey || "", (value) =>
		handleFieldChange("difyApiKey", value),
	)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = useDynamicProviderSelection("dify", apiConfiguration, currentMode)

	return (
		<div>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<DebouncedTextField
					initialValue={apiConfiguration?.difyBaseUrl || ""}
					onChange={(value) => {
						handleFieldChange("difyBaseUrl", value)
					}}
					placeholder={t("providers:shared.enterBaseUrlPlaceholder")}
					style={{ width: "100%", marginBottom: 10 }}
					type="text">
					<span style={{ fontWeight: 500 }}>{t("providers:shared.baseUrlLabel")}</span>
				</DebouncedTextField>

				<ApiKeyField
					initialValue={apiConfiguration?.difyApiKey || ""}
					onChange={(value) => {
						handleFieldChange("difyApiKey", value)
					}}
					providerName="Dify"
				/>

				<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "5px" }}>
					<p>{t("providers:dify.description")}</p>
					<p style={{ marginTop: "8px" }}>
						<strong>{t("providers:shared.noteLabel")}</strong> {t("providers:dify.modelSelectionNote")}
					</p>
				</div>
			</div>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
