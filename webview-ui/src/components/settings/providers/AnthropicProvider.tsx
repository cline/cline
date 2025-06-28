import { ApiConfiguration, anthropicModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Anthropic models that support thinking/reasoning mode
const SUPPORTED_THINKING_MODELS = ["claude-3-7-sonnet-20250219", "claude-sonnet-4-20250514", "claude-opus-4-20250514"]

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	setApiConfiguration?: (config: ApiConfiguration) => void
}

/**
 * The Anthropic provider configuration component
 */
export const AnthropicProvider = ({ showModelOptions, isPopup, setApiConfiguration }: AnthropicProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.apiKey || ""}
				onChange={(e) => handleFieldChange("apiKey", e.target.value)}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<BaseUrlField
				value={apiConfiguration?.anthropicBaseUrl}
				onChange={(e) => handleFieldChange("anthropicBaseUrl", e.target.value)}
				placeholder="Default: https://api.anthropic.com"
				label="Use custom base URL"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={anthropicModels}
						selectedModelId={selectedModelId}
						onChange={(e) => handleFieldChange("apiModelId", e.target.value)}
						label="Model"
					/>

					{SUPPORTED_THINKING_MODELS.includes(selectedModelId) && setApiConfiguration && (
						<ThinkingBudgetSlider maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
