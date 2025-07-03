import { ApiConfiguration, openAiNativeModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OpenAINativeProvider component
 */
interface OpenAINativeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The OpenAI (native) provider configuration component
 */
export const OpenAINativeProvider = ({ showModelOptions, isPopup }: OpenAINativeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.openAiNativeApiKey || ""}
				onChange={(value) => handleFieldChange("openAiNativeApiKey", value)}
				providerName="OpenAI"
				signupUrl="https://platform.openai.com/api-keys"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={openAiNativeModels}
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
