import { geminiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { normalizeApiConfiguration, supportsReasoningEffortForModelId } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the GeminiProvider component
 */
interface GeminiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Gemini provider configuration component
 */
export const GeminiProvider = ({ showModelOptions, isPopup, currentMode }: GeminiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.geminiApiKey || ""}
				onChange={(value) => handleFieldChange("geminiApiKey", value)}
				providerName="Gemini"
				signupUrl="https://aistudio.google.com/apikey"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.geminiBaseUrl}
				label="Use custom base URL"
				onChange={(value) => handleFieldChange("geminiBaseUrl", value)}
				placeholder="Default: https://generativelanguage.googleapis.com"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={geminiModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
