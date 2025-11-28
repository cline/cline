import { OpenRouterModelInfo } from "@shared/proto/cline/models"
import { IoIntelligenceModelsRequest } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the IoIntelligenceProvider component
 */
interface IoIntelligenceProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The IO Intelligence provider configuration component
 */
export const IoIntelligenceProvider = ({ showModelOptions, isPopup, currentMode }: IoIntelligenceProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// State for dynamic model fetching
	const [ioIntelligenceModels, setIoIntelligenceModels] = useState<Record<string, OpenRouterModelInfo>>({})
	const [isLoadingModels, setIsLoadingModels] = useState(false)
	const [modelError, setModelError] = useState<string | null>(null)
	const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false)
	const [localApiKey, setLocalApiKey] = useState(apiConfiguration?.ioIntelligenceApiKey || "")
	const [localBaseUrl, setLocalBaseUrl] = useState(apiConfiguration?.ioIntelligenceBaseUrl || "")

	// Update local state when apiConfiguration changes
	useEffect(() => {
		if (apiConfiguration?.ioIntelligenceApiKey) {
			setLocalApiKey(apiConfiguration.ioIntelligenceApiKey)
		}
		if (apiConfiguration?.ioIntelligenceBaseUrl) {
			setLocalBaseUrl(apiConfiguration.ioIntelligenceBaseUrl)
		}
	}, [apiConfiguration?.ioIntelligenceApiKey, apiConfiguration?.ioIntelligenceBaseUrl])

	// Function to fetch IO Intelligence models
	const fetchIoIntelligenceModels = useCallback(async () => {
		// Use local state which has the latest value from the input field
		const apiKeyToUse = localApiKey || apiConfiguration?.ioIntelligenceApiKey
		const baseUrlToUse = localBaseUrl || apiConfiguration?.ioIntelligenceBaseUrl || "https://api.intelligence.io.solutions"

		if (!apiKeyToUse || apiKeyToUse.trim() === "") {
			setModelError("Please enter your API key first")
			return
		}

		setIsLoadingModels(true)
		setModelError(null)
		setHasAttemptedFetch(true)

		try {
			const response = await ModelsServiceClient.refreshIoIntelligenceModels(
				IoIntelligenceModelsRequest.create({
					apiKey: apiKeyToUse,
					baseUrl: baseUrlToUse,
				}),
			)

			if (response && response.models) {
				setIoIntelligenceModels(response.models)
				setModelError(null)
			} else {
				setIoIntelligenceModels({})
				setModelError("No models found in response")
			}
		} catch (error) {
			console.error("Error fetching IO Intelligence models:", error)
			setModelError("Failed to fetch models. Please check your API key and try again.")
			setIoIntelligenceModels({})
		} finally {
			setIsLoadingModels(false)
		}
	}, [localApiKey, localBaseUrl, apiConfiguration?.ioIntelligenceApiKey, apiConfiguration?.ioIntelligenceBaseUrl])

	// Auto-fetch models when API key is first entered
	useEffect(() => {
		const hasKey = !!(localApiKey || apiConfiguration?.ioIntelligenceApiKey)
		if (showModelOptions && hasKey && !hasAttemptedFetch) {
			fetchIoIntelligenceModels()
		}
	}, [showModelOptions, localApiKey, apiConfiguration?.ioIntelligenceApiKey, hasAttemptedFetch, fetchIoIntelligenceModels])

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.ioIntelligenceApiKey || ""}
				onChange={(value) => {
					setLocalApiKey(value)
					handleFieldChange("ioIntelligenceApiKey", value)
				}}
				providerName="IO Intelligence"
				signupUrl="https://io.net/intelligence"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.ioIntelligenceBaseUrl}
				label="Base URL"
				onChange={(value) => {
					setLocalBaseUrl(value)
					handleFieldChange("ioIntelligenceBaseUrl", value)
				}}
				placeholder="Default: https://api.intelligence.io.solutions/api/v1"
			/>

			{showModelOptions && (
				<>
					<div className="flex items-center justify-between mb-2">
						<span className="font-medium">Model</span>
						<button
							className="text-[11px] px-2 py-1 bg-(--vscode-button-background) text-(--vscode-button-foreground) border-none rounded-sm cursor-pointer disabled:opacity-50"
							disabled={isLoadingModels}
							onClick={fetchIoIntelligenceModels}>
							{isLoadingModels ? "Fetching..." : "Fetch Models"}
						</button>
					</div>

					{!localApiKey && !apiConfiguration?.ioIntelligenceApiKey && (
						<div className="text-xs text-(--vscode-descriptionForeground) mb-2">
							Please enter your API key above to fetch available models
						</div>
					)}

					{modelError && <div className="text-xs text-(--vscode-errorForeground) mb-2">{modelError}</div>}

					{isLoadingModels && (
						<div className="text-xs text-(--vscode-descriptionForeground) mb-2">
							Loading models from IO Intelligence API...
						</div>
					)}

					{(localApiKey || apiConfiguration?.ioIntelligenceApiKey) &&
						!isLoadingModels &&
						Object.keys(ioIntelligenceModels).length === 0 &&
						hasAttemptedFetch && (
							<div className="text-xs text-(--vscode-descriptionForeground) mb-2">
								No models fetched yet. Click "Fetch Models" button to load available models.
							</div>
						)}

					<ModelSelector
						label=""
						models={ioIntelligenceModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{Object.keys(ioIntelligenceModels).length > 0 && (
						<div className="text-xs text-(--vscode-descriptionForeground) mt-1">
							{Object.keys(ioIntelligenceModels).length} models available
						</div>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
