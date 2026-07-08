import { Mode } from "@shared/storage/types"
import { type ProviderId } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import UseCustomPromptCheckbox from "../UseCustomPromptCheckbox"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

interface GenericProviderBaseUrlFieldConfig {
	label?: string
	placeholder?: string
}

interface GenericProviderApiKeyFieldConfig {
	label?: string
	placeholder?: string
	helpText?: string
}

export interface GenericProviderSettingsProps {
	providerId: ProviderId
	providerName: string
	signupUrl?: string
	apiKeyField?: GenericProviderApiKeyFieldConfig
	baseUrlField?: GenericProviderBaseUrlFieldConfig
	allowsCustomIds: boolean
	showCustomPromptCheckbox?: boolean
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * Shared settings shell for providers whose configuration is the common
 * catalog-backed shape: API key, optional base URL, model picker, and model
 * info. Provider-specific wrappers should pass metadata while custom providers
 * keep their own components.
 */
export const GenericProviderSettings = ({
	providerId,
	providerName,
	signupUrl,
	apiKeyField,
	baseUrlField,
	allowsCustomIds,
	showCustomPromptCheckbox,
	showModelOptions,
	isPopup,
	currentMode,
}: GenericProviderSettingsProps) => {
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels(providerId)
	const { config, write, commitSelection } = useProviderConfig(providerId)
	const { selectedModel, commitModelSelection } = useProviderModelSelection(providerId, currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
	})

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitModelSelection(selection).catch((err) =>
			console.error(`Failed to commit ${providerName} model selection:`, err),
		)
	}

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName,
		write,
	})
	const handleBaseUrlChange = (value: string) => {
		void write({ baseUrl: value }).catch((err) => console.error(`Failed to update ${providerName} base URL:`, err))
	}

	return (
		<div>
			<ApiKeyField
				helpText={apiKeyField?.helpText}
				initialValue={savedApiKeyMask}
				label={apiKeyField?.label}
				onChange={handleApiKeyChange}
				placeholder={apiKeyField?.placeholder}
				providerName={providerName}
				signupUrl={signupUrl}
			/>

			{baseUrlField && (
				<BaseUrlField
					initialValue={config?.baseUrl}
					label={baseUrlField.label}
					onChange={handleBaseUrlChange}
					placeholder={baseUrlField.placeholder}
				/>
			)}

			{showModelOptions && (
				<>
					<ModelPickerWithManualEntry
						allowsCustomIds={allowsCustomIds}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={models}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					{selectedModel.modelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							onEffortChange={(effort) => {
								void write({
									reasoning: {
										enabled: effort !== "none",
										effort: effort !== "none" ? effort : undefined,
									},
								}).catch((err) => console.error(`Failed to update ${providerName} reasoning effort:`, err))
							}}
						/>
					)}

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}

			{showCustomPromptCheckbox && <UseCustomPromptCheckbox providerId={providerId} />}
		</div>
	)
}
