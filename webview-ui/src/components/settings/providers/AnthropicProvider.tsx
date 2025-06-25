import { ApiConfiguration, anthropicModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"

// Anthropic models that support thinking/reasoning mode
const SUPPORTED_THINKING_MODELS = ["claude-3-7-sonnet-20250219", "claude-sonnet-4-20250514", "claude-opus-4-20250514"]

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
	setApiConfiguration?: (config: ApiConfiguration) => void
}

/**
 * The Anthropic provider configuration component
 */
export const AnthropicProvider = ({
	apiConfiguration,
	handleInputChange,
	showModelOptions,
	isPopup,
	setApiConfiguration,
}: AnthropicProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Create a wrapper for handling field changes more directly
	const handleFieldChange = (field: keyof ApiConfiguration) => (value: string) => {
		handleInputChange(field)({ target: { value } })
	}

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.apiKey || ""}
				onChange={handleInputChange("apiKey")}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<BaseUrlField
				value={apiConfiguration?.anthropicBaseUrl}
				onChange={handleFieldChange("anthropicBaseUrl")}
				placeholder="Default: https://api.anthropic.com"
				label="Use custom base URL"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={anthropicModels}
						selectedModelId={selectedModelId}
						onChange={handleInputChange("apiModelId")}
						label="Model"
					/>

					{SUPPORTED_THINKING_MODELS.includes(selectedModelId) && setApiConfiguration && (
						<ThinkingBudgetSlider
							apiConfiguration={apiConfiguration}
							setApiConfiguration={setApiConfiguration}
							maxBudget={selectedModelInfo.thinkingConfig?.maxBudget}
						/>
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
