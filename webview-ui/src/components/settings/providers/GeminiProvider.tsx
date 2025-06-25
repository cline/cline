import { ApiConfiguration, geminiModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"

// Gemini models that support thinking/reasoning mode
const SUPPORTED_THINKING_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"]

/**
 * Props for the GeminiProvider component
 */
interface GeminiProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
	setApiConfiguration?: (config: ApiConfiguration) => void
}

/**
 * The Gemini provider configuration component
 */
export const GeminiProvider = ({
	apiConfiguration,
	handleInputChange,
	showModelOptions,
	isPopup,
	setApiConfiguration,
}: GeminiProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Create a wrapper for handling field changes more directly
	const handleFieldChange = (field: keyof ApiConfiguration) => (value: string) => {
		handleInputChange(field)({ target: { value } })
	}

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.geminiApiKey || ""}
				onChange={handleInputChange("geminiApiKey")}
				providerName="Gemini"
				signupUrl="https://aistudio.google.com/apikey"
			/>

			<BaseUrlField
				value={apiConfiguration?.geminiBaseUrl}
				onChange={handleFieldChange("geminiBaseUrl")}
				placeholder="Default: https://generativelanguage.googleapis.com"
				label="Use custom base URL"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={geminiModels}
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
