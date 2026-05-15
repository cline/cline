import { type ApiConfiguration, openAiModelInfoSafeDefaults } from "@shared/api"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { Mode } from "@shared/storage/types"
import { type ProviderId, useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

type StringApiConfigurationKey = Exclude<
	{
		[K in keyof ApiConfiguration]: ApiConfiguration[K] extends string | undefined ? K : never
	}[keyof ApiConfiguration],
	undefined
>

export interface GenericProviderBaseUrlFieldConfig {
	field: StringApiConfigurationKey
	label?: string
	placeholder?: string
}

export interface GenericProviderSettingsProps {
	providerId: ProviderId
	providerName: string
	apiKeyField: StringApiConfigurationKey
	signupUrl?: string
	baseUrlField?: GenericProviderBaseUrlFieldConfig
	allowsCustomIds: boolean
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : ""
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
	apiKeyField,
	signupUrl,
	baseUrlField,
	allowsCustomIds,
	showModelOptions,
	isPopup,
	currentMode,
}: GenericProviderSettingsProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels(providerId)
	const { config, commitSelection } = useProviderConfig(providerId)
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

	return (
		<div>
			<ApiKeyField
				initialValue={stringValue(apiConfiguration?.[apiKeyField])}
				onChange={(value) => handleFieldChange(apiKeyField, value)}
				providerName={providerName}
				signupUrl={signupUrl}
			/>

			{baseUrlField && (
				<BaseUrlField
					initialValue={stringValue(apiConfiguration?.[baseUrlField.field]) || undefined}
					label={baseUrlField.label}
					onChange={(value) => handleFieldChange(baseUrlField.field, value)}
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
