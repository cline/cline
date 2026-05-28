import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

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
	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"sambanova",
		apiConfiguration,
		currentMode,
	)

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
						label="Model"
						models={models}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
