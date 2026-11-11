import { Mode } from "@shared/storage/types"
import { type ProviderId } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { reasoningEffortPatch } from "../utils/reasoningEffort"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

interface GenericProviderBaseUrlFieldConfig {
	label?: string
	placeholder?: string
}

export interface GenericProviderSettingsProps {
	providerId: ProviderId
	providerName: string
	signupUrl?: string
	baseUrlField?: GenericProviderBaseUrlFieldConfig
	allowsCustomIds: boolean
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
	baseUrlField,
	allowsCustomIds,
	showModelOptions,
	isPopup,
	currentMode,
}: GenericProviderSettingsProps) => {
	const { models, defaultModelId, isLoading, isStale, error, refresh } = useProviderModels(providerId)
	const { config, write, commitSelection, reasoningEffort } = useProviderConfig(providerId)
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

	const writeAndRefreshModels = async (patch: { apiKey?: string; baseUrl?: string }) => {
		const response = await write(patch)
		void refresh()
		return response
	}

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName,
		write: writeAndRefreshModels,
	})
	const handleBaseUrlChange = (value: string) => {
		void writeAndRefreshModels({ baseUrl: value }).catch((err) =>
			console.error(`Failed to update ${providerName} base URL:`, err),
		)
	}
	const handleBaseUrlClear = async () => {
		try {
			await writeAndRefreshModels({ baseUrl: "" })
		} catch (error) {
			console.error(`Failed to clear ${providerName} base URL:`, error)
			throw error
		}
	}

	return (
		<div>
			<ApiKeyField
				initialValue={savedApiKeyMask}
				onChange={handleApiKeyChange}
				placeholder="Enter API Key..."
				providerName={providerName}
				signupUrl={signupUrl}
			/>

			{baseUrlField && (
				<BaseUrlField
					initialValue={config?.baseUrl}
					label={baseUrlField.label}
					onChange={handleBaseUrlChange}
					onClear={handleBaseUrlClear}
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
								void write(reasoningEffortPatch(effort)).catch((err) =>
									console.error(`Failed to update ${providerName} reasoning effort:`, err),
								)
							}}
							value={reasoningEffort}
						/>
					)}

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}
