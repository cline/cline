import { ApiConfiguration, sambanovaModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { Mode } from "@shared/ChatSettings"

/**
 * Props for the SambanovaProvider component
 */
interface SambanovaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The SambaNova provider configuration component
 */
export const SambanovaProvider = ({ showModelOptions, isPopup, currentMode }: SambanovaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.sambanovaApiKey || ""}
				onChange={(value) => handleFieldChange("sambanovaApiKey", value)}
				providerName="SambaNova"
				signupUrl="https://docs.sambanova.ai/cloud/docs/get-started/overview"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={sambanovaModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
