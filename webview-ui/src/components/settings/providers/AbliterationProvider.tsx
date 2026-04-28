import { abliterationModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface AbliterationProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const AbliterationProvider = ({ showModelOptions, isPopup, currentMode }: AbliterationProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.abliterationApiKey || ""}
				onChange={(value) => handleFieldChange("abliterationApiKey", value)}
				providerName="Abliteration.ai"
				signupUrl="https://docs.abliteration.ai/quickstart"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={abliterationModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
