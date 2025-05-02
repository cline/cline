import { ApiConfiguration, deepSeekModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The DeepSeek provider configuration component
 */
export const DeepSeekProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: DeepSeekProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.deepSeekApiKey || ""}
				onChange={handleInputChange("deepSeekApiKey")}
				providerName="DeepSeek"
				signupUrl="https://www.deepseek.com/"
			/>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						models={deepSeekModels}
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
