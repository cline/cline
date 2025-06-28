import { ApiConfiguration, askSageModels, askSageDefaultURL } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ApiKeyField } from "../common/ApiKeyField"
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
				value={apiConfiguration?.asksageApiKey || ""}
				onChange={(e) => handleFieldChange("asksageApiKey", e.target.value)}
				providerName="AskSage"
				helpText="This key is stored locally and only used to make API requests from this extension."
			/>

			<VSCodeTextField
				value={apiConfiguration?.asksageApiUrl || askSageDefaultURL}
				style={{ width: "100%" }}
				type="url"
				onInput={(e: any) => handleFieldChange("asksageApiUrl", e.target.value)}
				placeholder="Enter AskSage API URL...">
				<span style={{ fontWeight: 500 }}>AskSage API URL</span>
			</VSCodeTextField>

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
