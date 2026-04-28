import { deepSeekModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The DeepSeek provider configuration component
 */
export const DeepSeekProvider = ({ showModelOptions, isPopup, currentMode }: DeepSeekProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const modelInfo = deepSeekModels[selectedModelId as keyof typeof deepSeekModels]
	const showReasoningEffort = (modelInfo as any)?.supportsReasoningEffort === true
	// V4 Pro uses reasoning_effort to control reasoning depth, not a thinking budget API param.
	// Only show the slider for models that support reasoning WITHOUT reasoning_effort.
	const showThinkingBudget =
		(modelInfo as any)?.supportsReasoning === true && (modelInfo as any)?.supportsReasoningEffort !== true

	return (
		<div>
			<BaseUrlField
				initialValue={apiConfiguration?.deepSeekBaseUrl}
				label="Use custom base URL"
				onChange={(value) => handleFieldChange("deepSeekBaseUrl", value)}
				placeholder="Default: https://api.deepseek.com"
			/>

			<ApiKeyField
				initialValue={apiConfiguration?.deepSeekApiKey || ""}
				onChange={(value) => handleFieldChange("deepSeekApiKey", value)}
				providerName="DeepSeek"
				signupUrl="https://www.deepseek.com/"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={deepSeekModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{showReasoningEffort && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							defaultEffort="high"
							description="Controls reasoning depth for DeepSeek V4 Pro. Higher effort improves complex reasoning at the cost of more tokens."
						/>
					)}

					{showThinkingBudget && <ThinkingBudgetSlider currentMode={currentMode} minBudget={8192} />}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
