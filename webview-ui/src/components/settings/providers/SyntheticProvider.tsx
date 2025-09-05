import { syntheticModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the SyntheticProvider component
 */
interface SyntheticProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Synthetic provider configuration component
 */
export const SyntheticProvider = ({ isPopup, currentMode }: SyntheticProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.syntheticApiKey || ""}
				onChange={(value) => handleFieldChange("syntheticApiKey", value)}
				providerName="Synthetic"
				signupUrl="https://synthetic.new/"
			/>
			<ModelSelector
				label="Model"
				models={syntheticModels}
				onChange={(e: any) => {
					handleModeFieldChange(
						{
							plan: "planModeSyntheticModelId",
							act: "actModeSyntheticModelId",
						},
						e.target.value,
						currentMode,
					)
				}}
				selectedModelId={selectedModelId}
			/>
			<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
		</div>
	)
}
