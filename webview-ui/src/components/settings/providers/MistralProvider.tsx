import { useExtensionState } from "@/context/ExtensionStateContext"
import { mistralModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the MistralProvider component
 */
interface MistralProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Mistral provider configuration component
 */
export const MistralProvider = ({ showModelOptions, isPopup }: MistralProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.mistralApiKey || ""}
				onChange={(value) => handleFieldChange("mistralApiKey", value)}
				providerName="Mistral"
				signupUrl="https://console.mistral.ai/codestral"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={mistralModels}
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
