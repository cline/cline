import { ApiConfiguration, nebiusModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the NebiusProvider component
 */
interface NebiusProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Nebius AI Studio provider configuration component
 */
export const NebiusProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: NebiusProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.nebiusApiKey || ""}
				onChange={handleInputChange("nebiusApiKey")}
				providerName="Nebius"
				signupUrl="https://studio.nebius.com/settings/api-keys"
				helpText="This key is stored locally and only used to make API requests from this extension. (Note: Cline uses complex prompts and works best with Claude models. Less capable models may not work as expected.)"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={nebiusModels}
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
