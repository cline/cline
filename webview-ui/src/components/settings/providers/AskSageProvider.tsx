import { ApiConfiguration, askSageModels, askSageDefaultURL } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the AskSageProvider component
 */
interface AskSageProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The AskSage provider configuration component
 */
export const AskSageProvider = ({ showModelOptions, isPopup }: AskSageProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.asksageApiKey || ""}
				onChange={(value) => handleFieldChange("asksageApiKey", value)}
				providerName="AskSage"
				helpText="This key is stored locally and only used to make API requests from this extension."
			/>

			<DebouncedTextField
				initialValue={apiConfiguration?.asksageApiUrl || askSageDefaultURL}
				onChange={(value) => handleFieldChange("asksageApiUrl", value)}
				style={{ width: "100%" }}
				type="url"
				placeholder="Enter AskSage API URL...">
				<span style={{ fontWeight: 500 }}>AskSage API URL</span>
			</DebouncedTextField>

			{showModelOptions && (
				<>
					<ModelSelector
						models={askSageModels}
						selectedModelId={selectedModelId}
						onChange={(e) => handleFieldChange("apiModelId", e.target.value)}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
