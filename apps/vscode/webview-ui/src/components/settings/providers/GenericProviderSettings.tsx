import { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useRef } from "react"
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

// Providers whose model catalog is fetched with the user's API key (mirrors
// PRIVATE_PROVIDER_MODEL_FETCHERS in @cline/core). Static-catalog providers do
// not use credentials to resolve their model list.
const CREDENTIAL_BACKED_CATALOG_PROVIDER_IDS = new Set<string>(["baseten", "hicap", "litellm", "poolside"])
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

	const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pendingWriteRef = useRef<Promise<unknown> | null>(null)
	const needsModelRefreshRef = useRef(false)
	const isInputFocusedRef = useRef(false)

	const clearRefreshTimer = useCallback(() => {
		if (refreshTimerRef.current !== null) {
			clearTimeout(refreshTimerRef.current)
			refreshTimerRef.current = null
		}
	}, [])

	useEffect(() => {
		return () => clearRefreshTimer()
	}, [clearRefreshTimer])

	const shouldRefreshModelsForPatch = (patch: { apiKey?: string; baseUrl?: string }): boolean => {
		if ("baseUrl" in patch) {
			return true
		}
		return CREDENTIAL_BACKED_CATALOG_PROVIDER_IDS.has(providerId) || Boolean(error) || Object.keys(models).length === 0
	}

	const writeAndScheduleRefresh = async (patch: { apiKey?: string; baseUrl?: string }, immediate = false) => {
		const shouldRefresh = shouldRefreshModelsForPatch(patch)
		if (shouldRefresh) {
			clearRefreshTimer()
			needsModelRefreshRef.current = true
		}
		const writePromise = write(patch)
		pendingWriteRef.current = writePromise
		try {
			const response = await writePromise
			if (shouldRefresh && pendingWriteRef.current === writePromise && needsModelRefreshRef.current) {
				clearRefreshTimer()
				if (immediate || !isInputFocusedRef.current) {
					needsModelRefreshRef.current = false
					void refresh()
				} else {
					refreshTimerRef.current = setTimeout(() => {
						refreshTimerRef.current = null
						if (needsModelRefreshRef.current) {
							needsModelRefreshRef.current = false
							void refresh()
						}
					}, MODEL_REFRESH_DEBOUNCE_MS)
				}
			}
			return response
		} finally {
			if (pendingWriteRef.current === writePromise) {
				pendingWriteRef.current = null
			}
		}
	}

	const handleInputFocus = useCallback(() => {
		isInputFocusedRef.current = true
	}, [])

	const flushPendingModelRefresh = useCallback(() => {
		isInputFocusedRef.current = false
		clearRefreshTimer()
		const inFlight = pendingWriteRef.current
		if (inFlight) {
			void inFlight
				.then(() => {
					if (needsModelRefreshRef.current) {
						needsModelRefreshRef.current = false
						clearRefreshTimer()
						void refresh()
					}
				})
				.catch(() => {})
			return
		}
		if (needsModelRefreshRef.current) {
			needsModelRefreshRef.current = false
			void refresh()
		}
	}, [clearRefreshTimer, refresh])

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName,
		write: (patch) => writeAndScheduleRefresh(patch),
	})
	const handleBaseUrlChange = (value: string) => {
		void writeAndScheduleRefresh({ baseUrl: value }).catch((err) =>
			console.error(`Failed to update ${providerName} base URL:`, err),
		)
	}
	const handleBaseUrlClear = async () => {
		try {
			await writeAndScheduleRefresh({ baseUrl: "" }, true)
		} catch (error) {
			console.error(`Failed to clear ${providerName} base URL:`, error)
			throw error
		}
	}

	return (
		<div>
			<ApiKeyField
				initialValue={savedApiKeyMask}
				onBlur={flushPendingModelRefresh}
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
					onBlur={flushPendingModelRefresh}
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
