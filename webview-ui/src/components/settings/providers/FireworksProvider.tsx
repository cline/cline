import { ApiKeyField } from "../common/ApiKeyField"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { fireworksModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { useEffect } from "react"
import { fireworksDefaultModelId } from "@shared/api"
/**
 * Props for the FireworksProvider component
 */
interface FireworksProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Fireworks provider configuration component
 */
export const FireworksProvider = ({ showModelOptions, isPopup, currentMode }: FireworksProviderProps) => {
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
				models={fireworksModels}
				selectedModelId={selectedModelId}
				onChange={(e: any) => {
					handleModeFieldChange(
						{ plan: "planModeFireworksModelId", act: "actModeFireworksModelId" },
						e.target.value,
						currentMode,
					)
				}}
				label="Model"
			/>

			<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
		</div>
	)
}
