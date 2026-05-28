import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the CerebrasProvider component
 */
interface CerebrasProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Cerebras provider configuration component
 */
export const CerebrasProvider = ({ showModelOptions, isPopup, currentMode }: CerebrasProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"cerebras",
		apiConfiguration,
		currentMode,
	)

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
