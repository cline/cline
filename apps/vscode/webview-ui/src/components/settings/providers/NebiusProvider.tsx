import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the NebiusProvider component
 */
interface NebiusProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Nebius AI Studio provider configuration component
 */
export const NebiusProvider = ({ showModelOptions, isPopup, currentMode }: NebiusProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"nebius",
		apiConfiguration,
		currentMode,
	)

	return (
		<div>
			<ApiKeyField
				helpText="This key is stored locally and only used to make API requests from this extension. (Note: Cline uses complex prompts, so behavior can vary across models. Less capable models may not work as expected.)"
				initialValue={apiConfiguration?.nebiusApiKey || ""}
				onChange={(value) => handleFieldChange("nebiusApiKey", value)}
				providerName="Nebius"
				signupUrl="https://studio.nebius.com/settings/api-keys"
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
