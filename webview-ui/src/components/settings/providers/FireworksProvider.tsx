import { fireworksModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the FireworksProvider component
 */
interface FireworksProviderProps {
	currentMode: Mode
	isPopup?: boolean
	showModelOptions: boolean
}

/**
 * The Fireworks provider configuration component
 */
export const FireworksProvider = ({ currentMode, isPopup, showModelOptions }: FireworksProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange, handleFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.fireworksApiKey || ""}
				onChange={(value) => handleFieldChange("fireworksApiKey", value)}
				providerName="Fireworks"
				signupUrl="https://fireworks.ai/"
			/>
			<ModelSelector
				label="Model"
				models={fireworksModels}
				onChange={(e: any) => {
					handleModeFieldChange(
						{
							plan: "planModeFireworksModelId",
							act: "actModeFireworksModelId",
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
