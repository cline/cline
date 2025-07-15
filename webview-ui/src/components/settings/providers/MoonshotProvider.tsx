import { moonshotModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the MoonshotProvider component
 */
interface MoonshotProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Moonshot AI Studio provider configuration component
 */
export const MoonshotProvider = ({ showModelOptions, isPopup }: MoonshotProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.moonshotApiKey || ""}
				onChange={(value) => handleFieldChange("moonshotApiKey", value)}
				providerName="Moonshot"
				signupUrl="https://platform.moonshot.ai/console/api-keys"
				helpText="This key is stored locally and only used to make API requests from this extension."
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={moonshotModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) => handleFieldChange("apiModelId", e.target.value)}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
