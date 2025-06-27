import { ApiConfiguration, cerebrasModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the CerebrasProvider component
 */
interface CerebrasProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Cerebras provider configuration component
 */
export const CerebrasProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: CerebrasProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.cerebrasApiKey || ""}
				onChange={handleInputChange("cerebrasApiKey")}
				providerName="Cerebras"
				signupUrl="https://cloud.cerebras.ai/"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={cerebrasModels}
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
