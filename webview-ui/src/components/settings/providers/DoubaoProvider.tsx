import { ApiConfiguration, doubaoModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the DoubaoProvider component
 */
interface DoubaoProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The ByteDance Doubao provider configuration component
 */
export const DoubaoProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: DoubaoProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.doubaoApiKey || ""}
				onChange={handleInputChange("doubaoApiKey")}
				providerName="Doubao"
				signupUrl="https://console.volcengine.com/home"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={doubaoModels}
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
