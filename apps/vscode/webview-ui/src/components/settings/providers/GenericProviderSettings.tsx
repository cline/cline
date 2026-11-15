import { Mode } from "@shared/storage/types"
import { useRef, useState } from "react"
import { type ProviderId } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { useDebounceEffect } from "@/utils/useDebounceEffect"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { reasoningEffortPatch } from "../utils/reasoningEffort"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

const MODEL_REFRESH_DEBOUNCE_MS = 500

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

	const [refreshRevision, setRefreshRevision] = useState(0)
	const hasUnrefreshedChangeRef = useRef(false)
	const isInputFocusedRef = useRef(false)

	const flushModelRefresh = () => {
		if (hasUnrefreshedChangeRef.current) {
			hasUnrefreshedChangeRef.current = false
			void refresh()
		}
	}

	useDebounceEffect(flushModelRefresh, MODEL_REFRESH_DEBOUNCE_MS, [refreshRevision])

	const writeAndRefreshModels = async (patch: { apiKey?: string; baseUrl?: string }) => {
		const response = await write(patch)
		hasUnrefreshedChangeRef.current = true
		if (isInputFocusedRef.current) {
			setRefreshRevision((rev) => rev + 1)
		} else {
			flushModelRefresh()
		}
		return response
	}

	const handleInputFocus = () => {
		isInputFocusedRef.current = true
	}

	const handleInputBlur = () => {
		isInputFocusedRef.current = false
		flushModelRefresh()
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
				onBlur={handleInputBlur}
				onChange={handleApiKeyChange}
				onFocus={handleInputFocus}
				placeholder="Enter API Key..."
				providerName={providerName}
				signupUrl={signupUrl}
			/>

			{baseUrlField && (
				<BaseUrlField
					initialValue={config?.baseUrl}
					label={baseUrlField.label}
					onBlur={handleInputBlur}
					onChange={handleBaseUrlChange}
					onClear={handleBaseUrlClear}
					onFocus={handleInputFocus}
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
