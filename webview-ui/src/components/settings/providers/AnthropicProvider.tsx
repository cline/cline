import { ApiConfiguration, anthropicModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Anthropic provider configuration component
 */
export const AnthropicProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: AnthropicProviderProps) => {
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

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
