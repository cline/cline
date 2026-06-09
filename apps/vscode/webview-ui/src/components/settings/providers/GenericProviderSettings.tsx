import { openAiModelInfoSafeDefaults } from "@shared/api"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { Mode } from "@shared/storage/types"
import { type ProviderId } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

const SAVED_API_KEY_MASK_CHARACTER = "•"

function maskedKey(apiKeyLength: number | undefined): string {
	return SAVED_API_KEY_MASK_CHARACTER.repeat(Math.max(0, apiKeyLength ?? 0))
}

function sanitizeApiKeyInput(value: string, savedMask: string): string | undefined {
	if (!savedMask || !value.includes(SAVED_API_KEY_MASK_CHARACTER)) {
		return value
	}

	if (value === savedMask) {
		return undefined
	}

	return value.split(SAVED_API_KEY_MASK_CHARACTER).join("")
}

export interface GenericProviderBaseUrlFieldConfig {
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
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels(providerId)
	const { config, write, commitSelection } = useProviderConfig(providerId)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const fallbackModelId = defaultModelId || Object.keys(models)[0] || ""

	const selectedModel: ModelPickerSelection =
		committedSelection?.modelInfo !== undefined
			? {
					providerId,
					modelId: committedSelection.modelId,
					modelInfo: fromProtobufModelInfo(committedSelection.modelInfo),
				}
			: {
					providerId,
					modelId: fallbackModelId,
					modelInfo: models[fallbackModelId] ?? openAiModelInfoSafeDefaults,
				}

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitSelection(currentMode, selection).catch((err) =>
			console.error(`Failed to commit ${providerName} model selection:`, err),
		)
	}

	const savedApiKeyMask = maskedKey(config?.apiKeyLength)

	const handleApiKeyChanged = (value: string) => {
		const apiKey = sanitizeApiKeyInput(value, savedApiKeyMask)

		if (apiKey === undefined) {
			return
		}

		void write({ apiKey }).catch((err) => console.error(`Failed to update ${providerName} API key:`, err))
	}
	const handleBaseUrlChange = (value: string) => {
		void write({ baseUrl: value }).catch((err) => console.error(`Failed to update ${providerName} base URL:`, err))
	}

	return (
		<div>
			<ApiKeyField
				initialValue={savedApiKeyMask}
				onChange={handleApiKeyChanged}
				placeholder="Enter API Key..."
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
