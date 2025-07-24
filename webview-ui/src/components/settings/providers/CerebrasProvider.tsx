import { cerebrasModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Mode } from "@shared/ChatSettings"

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
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

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
