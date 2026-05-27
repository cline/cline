import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
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

	const savedFireworksModelId =
		currentMode === "plan" ? apiConfiguration?.planModeFireworksModelId : apiConfiguration?.actModeFireworksModelId
	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"fireworks",
		apiConfiguration,
		currentMode,
		{ savedModelId: savedFireworksModelId },
	)

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
				models={models}
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

			<ModelInfoView
				hideUsageCost={hideUsageCost}
				isPopup={isPopup}
				modelInfo={selectedModelInfo}
				selectedModelId={selectedModelId}
			/>
		</div>
	)
}
