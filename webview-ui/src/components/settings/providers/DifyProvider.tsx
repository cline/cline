import { Mode } from "@shared/storage/types"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
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
	const [_baseUrlValue, _setBaseUrlValue] = useDebouncedInput(apiConfiguration?.difyBaseUrl || "", (value) =>
		handleFieldChange("difyBaseUrl", value),
	)

	const [_apiKeyValue, _setApiKeyValue] = useDebouncedInput(apiConfiguration?.difyApiKey || "", (value) =>
		handleFieldChange("difyApiKey", value),
	)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<DebouncedTextField
					initialValue={apiConfiguration?.difyBaseUrl || ""}
					onChange={(value) => {
						handleFieldChange("difyBaseUrl", value)
					}}
					placeholder={"Enter base URL..."}
					style={{ width: "100%", marginBottom: 10 }}
					type="text">
					<span style={{ fontWeight: 500 }}>Base URL</span>
				</DebouncedTextField>

				<ApiKeyField
					initialValue={apiConfiguration?.difyApiKey || ""}
					onChange={(value) => {
						handleFieldChange("difyApiKey", value)
					}}
					providerName="Dify"
				/>

				<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "5px" }}>
					<p>{t("providers.difyDescription")}</p>
					<p style={{ marginTop: "8px" }}>
						<strong>{t("providers.difyModelNote").split(":")[0]}:</strong>{" "}
						{t("providers.difyModelNote").split(":")[1]}
					</p>
				</div>
			</div>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
