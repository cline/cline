import { nebiusModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the NebiusProvider component
 */
interface NebiusProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Nebius AI Studio provider configuration component
 */
export const NebiusProvider = ({ showModelOptions, isPopup }: NebiusProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.nebiusApiKey || ""}
				onChange={(value) => handleFieldChange("nebiusApiKey", value)}
				providerName="Nebius"
				signupUrl="https://studio.nebius.com/settings/api-keys"
				helpText="This key is stored locally and only used to make API requests from this extension. (Note: Cline uses complex prompts and works best with Claude models. Less capable models may not work as expected.)"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={nebiusModels}
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
