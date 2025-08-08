import { useExtensionState } from "@/context/ExtensionStateContext"
import { cerebrasModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the CerebrasProvider component
 */
interface CerebrasProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Cerebras provider configuration component
 */
export const CerebrasProvider = ({ showModelOptions, isPopup }: CerebrasProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.cerebrasApiKey || ""}
				onChange={(value) => handleFieldChange("cerebrasApiKey", value)}
				providerName="Cerebras"
				signupUrl="https://cloud.cerebras.ai/"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={cerebrasModels}
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
