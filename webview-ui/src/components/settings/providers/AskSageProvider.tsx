import { ApiConfiguration, askSageModels, askSageDefaultURL } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the AskSageProvider component
 */
interface AskSageProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The AskSage provider configuration component
 */
export const AskSageProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: AskSageProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.asksageApiKey || ""}
				onChange={handleInputChange("asksageApiKey")}
				providerName="AskSage"
				helpText="This key is stored locally and only used to make API requests from this extension."
			/>

			<VSCodeTextField
				value={apiConfiguration?.asksageApiUrl || askSageDefaultURL}
				style={{ width: "100%" }}
				type="url"
				onInput={handleInputChange("asksageApiUrl")}
				placeholder="Enter AskSage API URL...">
				<span style={{ fontWeight: 500 }}>AskSage API URL</span>
			</VSCodeTextField>

			{showModelOptions && (
				<>
					<ModelSelector
						models={askSageModels}
						selectedModelId={selectedModelId}
						onChange={handleInputChange("apiModelId")}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
