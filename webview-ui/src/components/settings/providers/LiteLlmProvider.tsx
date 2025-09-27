import { liteLlmModelInfoSaneDefaults, ModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the LiteLlmProvider component
 */
interface LiteLlmProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The LiteLLM provider configuration component
 */
export const LiteLlmProvider = ({ showModelOptions, isPopup, currentMode }: LiteLlmProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Get mode-specific fields
	const { liteLlmModelId, liteLlmModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)

	// Local state for collapsible model configuration section
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	// State for available models
	const [availableModels, setAvailableModels] = useState<Record<string, ModelInfo>>({})
	const [isLoadingModels, setIsLoadingModels] = useState(false)
	const [modelFetchError, setModelFetchError] = useState<string | null>(null)

	// Function to fetch models from LiteLLM API
	const fetchModels = async () => {
		// Reset states
		setIsLoadingModels(true)
		setModelFetchError(null)

		const baseUrl = apiConfiguration?.liteLlmBaseUrl || "http://localhost:4000"
		const apiKey = apiConfiguration?.liteLlmApiKey || "noop"

		try {
			// Handle base URLs that already include /v1 to avoid double /v1/v1/
			const apiBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`

			// Use the /v1/models endpoint
			const endpoints = [`${apiBaseUrl}/models`]

			let data = null
			let lastError = null

			// Try each endpoint with both authentication methods
			for (const url of endpoints) {
				if (data) break // Stop if we already have data

				try {
					// Try with x-litellm-api-key header first
					const response = await fetch(url, {
						method: "GET",
						headers: {
							accept: "application/json",
							"x-litellm-api-key": apiKey,
						},
					})

					if (response.ok) {
						data = await response.json()
						break
					} else {
						const responseText = await response.text()
					}

					// Try with Authorization header if the first attempt fails
					const retryResponse = await fetch(url, {
						method: "GET",
						headers: {
							accept: "application/json",
							Authorization: `Bearer ${apiKey}`,
						},
					})

					if (retryResponse.ok) {
						data = await retryResponse.json()
						break
					}

					// Store the error for later if both attempts fail
					const responseText = await retryResponse.text()
					const errorMsg = `Status: ${retryResponse.status} ${retryResponse.statusText}, Body: ${responseText}`
					lastError = errorMsg
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error)
					lastError = errorMsg
				}
			}

			// If we couldn't get data from any endpoint, throw an error
			if (!data) {
				throw new Error(`Failed to fetch models from any endpoint. Last error: ${lastError}`)
			}

			// Convert the response to the format expected by ModelSelector
			const modelMap: Record<string, ModelInfo> = {}

			// Handle different response formats
			if (data && data.data && Array.isArray(data.data)) {
				// Format 1: OpenAI-like format with data.data array
				data.data.forEach((model: any) => {
					// Handle different model object structures
					const modelId = model.id || model.model_name || model.name
					if (modelId) {
						modelMap[modelId] = {
							maxTokens: -1, // Default value
							contextWindow: 128000, // Default value
							supportsImages: false, // Default value
							supportsPromptCache: false, // Default value
							inputPrice: 0, // Default value
							outputPrice: 0, // Default value
						}
					}
				})
			} else if (data && Array.isArray(data)) {
				// Format 2: Direct array of models
				data.forEach((model: any) => {
					const modelId = model.id || model.model_name || model.name
					if (modelId) {
						modelMap[modelId] = {
							maxTokens: -1, // Default value
							contextWindow: 128000, // Default value
							supportsImages: false, // Default value
							supportsPromptCache: false, // Default value
							inputPrice: 0, // Default value
							outputPrice: 0, // Default value
						}
					}
				})
			} else if (data && typeof data === "object") {
				// Format 3: Object with model names as keys
				Object.keys(data).forEach((modelId) => {
					if (modelId) {
						modelMap[modelId] = {
							maxTokens: -1, // Default value
							contextWindow: 128000, // Default value
							supportsImages: false, // Default value
							supportsPromptCache: false, // Default value
							inputPrice: 0, // Default value
							outputPrice: 0, // Default value
						}
					}
				})
			}

			// If we didn't find any models, throw an error
			if (Object.keys(modelMap).length === 0) {
				throw new Error("No models found in the API response. Response format may be unsupported.")
			}

			setAvailableModels(modelMap)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			setModelFetchError(errorMessage)
		} finally {
			setIsLoadingModels(false)
		}
	}

	// Fetch models when base URL or API key changes
	useEffect(() => {
		if (apiConfiguration?.liteLlmBaseUrl && apiConfiguration?.liteLlmApiKey) {
			fetchModels()
		}
	}, [apiConfiguration?.liteLlmBaseUrl, apiConfiguration?.liteLlmApiKey])

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmBaseUrl || ""}
				onChange={(value) => handleFieldChange("liteLlmBaseUrl", value)}
				placeholder={"Default: http://localhost:4000"}
				style={{ width: "100%" }}
				type="url">
				<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
			</DebouncedTextField>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmApiKey || ""}
				onChange={(value) => handleFieldChange("liteLlmApiKey", value)}
				placeholder="Default: noop"
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</DebouncedTextField>

			<div style={{ marginTop: "10px", marginBottom: "10px" }}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
					<span style={{ fontWeight: 500 }}>Model</span>
					<VSCodeButton
						appearance="icon"
						disabled={isLoadingModels || !apiConfiguration?.liteLlmBaseUrl}
						onClick={fetchModels}
						title="Refresh models">
						<span
							className={`codicon ${isLoadingModels ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}`}></span>
					</VSCodeButton>
				</div>

				{Object.keys(availableModels).length > 0 ? (
					<ModelSelector
						label=""
						models={availableModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={liteLlmModelId}
					/>
				) : (
					<DebouncedTextField
						initialValue={liteLlmModelId || ""}
						onChange={(value) =>
							handleModeFieldChange(
								{ plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
								value,
								currentMode,
							)
						}
						placeholder={"e.g. anthropic/claude-sonnet-4-20250514"}
						style={{ width: "100%" }}
					/>
				)}

				{modelFetchError && (
					<div style={{ color: "var(--vscode-errorForeground)", fontSize: "12px", marginTop: "5px" }}>
						<p>Error: {modelFetchError}</p>
						<p style={{ marginTop: "5px" }}>
							Try these troubleshooting steps:
							<ul style={{ marginTop: "3px", paddingLeft: "15px" }}>
								<li>Verify your Base URL is correct (e.g., http://localhost:4000)</li>
								<li>Check that your API Key is valid</li>
								<li>Ensure your LiteLLM server is running and accessible</li>
								<li>Check if CORS is enabled on your LiteLLM server</li>
							</ul>
						</p>
					</div>
				)}

				{isLoadingModels && (
					<p style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px", marginTop: "5px" }}>
						Loading models...
					</p>
				)}

				{!isLoadingModels &&
					!modelFetchError &&
					Object.keys(availableModels).length === 0 &&
					apiConfiguration?.liteLlmBaseUrl &&
					apiConfiguration?.liteLlmApiKey && (
						<p style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px", marginTop: "5px" }}>
							No models found. Click the refresh button to fetch models.
						</p>
					)}
			</div>

			<div style={{ display: "flex", flexDirection: "column", marginTop: 10, marginBottom: 10 }}>
				{selectedModelInfo.supportsPromptCache && (
					<>
						<VSCodeCheckbox
							checked={apiConfiguration?.liteLlmUsePromptCache || false}
							onChange={(e: any) => {
								const isChecked = e.target.checked === true

								handleFieldChange("liteLlmUsePromptCache", isChecked)
							}}
							style={{ fontWeight: 500, color: "var(--vscode-charts-green)" }}>
							Use prompt caching (GA)
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-charts-green)" }}>
							Prompt caching requires a supported provider and model
						</p>
					</>
				)}
			</div>

			<ThinkingBudgetSlider currentMode={currentMode} />
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Extended thinking is available for models such as Sonnet-4, o3-mini, Deepseek R1, etc. More info on{" "}
				<VSCodeLink
					href="https://docs.litellm.ai/docs/reasoning_content"
					style={{ display: "inline", fontSize: "inherit" }}>
					thinking mode configuration
				</VSCodeLink>
			</p>

			<div
				onClick={() => setModelConfigurationSelected((val) => !val)}
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}>
				<span
					className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{
						marginRight: "4px",
					}}></span>
				<span
					style={{
						fontWeight: 700,
						textTransform: "uppercase",
					}}>
					Model Configuration
				</span>
			</div>
			{modelConfigurationSelected && (
				<>
					<VSCodeCheckbox
						checked={!!liteLlmModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked

							handleModeFieldChange(
								{ plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
								modelInfo,
								currentMode,
							)
						}}>
						Supports Images
					</VSCodeCheckbox>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								liteLlmModelInfo?.contextWindow
									? liteLlmModelInfo.contextWindow.toString()
									: (liteLlmModelInfoSaneDefaults.contextWindow?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(value)

								handleModeFieldChange(
									{ plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>
						<DebouncedTextField
							initialValue={
								liteLlmModelInfo?.maxTokens
									? liteLlmModelInfo.maxTokens.toString()
									: (liteLlmModelInfoSaneDefaults.maxTokens?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }
								modelInfo.maxTokens = Number(value)

								handleModeFieldChange(
									{ plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								liteLlmModelInfo?.temperature !== undefined
									? liteLlmModelInfo.temperature.toString()
									: (liteLlmModelInfoSaneDefaults.temperature?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }

								modelInfo.temperature =
									value === "" ? liteLlmModelInfoSaneDefaults.temperature : parseFloat(value)

								handleModeFieldChange(
									{ plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
									modelInfo,
									currentMode,
								)
							}}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
					</div>
				</>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				LiteLLM provides a unified interface to access various LLM providers' models. See their{" "}
				<VSCodeLink href="https://docs.litellm.ai/docs/" style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide
				</VSCodeLink>{" "}
				for more information.
			</p>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
