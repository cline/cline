import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip"
import { azureOpenAiDefaultApiVersion, type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { parsePrice } from "../utils/pricingUtils"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI Compatible provider configuration component
 */
export const OpenAICompatibleProvider = ({ showModelOptions, isPopup, currentMode }: OpenAICompatibleProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("openai")

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isCustomOpenAiModelEntryVisible, setIsCustomOpenAiModelEntryVisible] = useState(false)
	const [availableOpenAiModels, setAvailableOpenAiModels] = useState<string[]>([])
	const [isRefreshingOpenAiModels, setIsRefreshingOpenAiModels] = useState(false)
	const [openAiModelsError, setOpenAiModelsError] = useState<string | undefined>(undefined)
	const latestOpenAiBaseUrlRef = useRef(config?.baseUrl || "")
	const latestOpenAiApiKeyRef = useRef(apiConfiguration?.openAiApiKey || "")
	const openAiModelsRequestRef = useRef(0)

	useEffect(() => {
		latestOpenAiBaseUrlRef.current = config?.baseUrl || ""
	}, [config?.baseUrl])

	useEffect(() => {
		latestOpenAiApiKeyRef.current = apiConfiguration?.openAiApiKey || ""
	}, [apiConfiguration?.openAiApiKey])

	const handleProviderConfigWriteError = useCallback((fieldName: string, error: unknown) => {
		console.error(`Failed to update OpenAI Compatible ${fieldName}:`, error)
	}, [])

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = useDynamicProviderSelection("openai", apiConfiguration, currentMode)

	// Get mode-specific fields
	const { openAiModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)

	const commitOpenAiSelection = useCallback(
		(modelId: string, modelInfo = openAiModelInfo ?? openAiModelInfoSafeDefaults) => {
			if (!modelId.trim()) {
				return
			}

			void commitSelection(currentMode, {
				providerId: "openai",
				modelId,
				modelInfo: {
					...modelInfo,
					supportsPromptCache: modelInfo.supportsPromptCache ?? openAiModelInfoSafeDefaults.supportsPromptCache,
				},
			}).catch((error) => handleProviderConfigWriteError("model selection", error))
		},
		[commitSelection, currentMode, handleProviderConfigWriteError, openAiModelInfo],
	)

	const handleOpenAiModelInfoChange = useCallback(
		(modelInfo: typeof openAiModelInfoSafeDefaults) => {
			handleModeFieldChange({ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" }, modelInfo, currentMode)
			commitOpenAiSelection(selectedModelId || "", modelInfo)
		},
		[commitOpenAiSelection, currentMode, handleModeFieldChange, selectedModelId],
	)

	// Debounced function to refresh OpenAI models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const refreshOpenAiModels = useCallback(async (baseUrl?: string, apiKey?: string) => {
		const trimmedBaseUrl = baseUrl?.trim()
		const requestId = openAiModelsRequestRef.current + 1
		openAiModelsRequestRef.current = requestId

		if (!trimmedBaseUrl) {
			setAvailableOpenAiModels([])
			setOpenAiModelsError(undefined)
			setIsRefreshingOpenAiModels(false)
			return
		}

		setIsRefreshingOpenAiModels(true)
		setOpenAiModelsError(undefined)

		try {
			const response = await ModelsServiceClient.refreshOpenAiModels(
				OpenAiModelsRequest.create({
					baseUrl: trimmedBaseUrl,
					apiKey,
				}),
			)

			if (openAiModelsRequestRef.current === requestId) {
				setAvailableOpenAiModels(response.values)
			}
		} catch (error) {
			console.error("Failed to refresh OpenAI models:", error)
			if (openAiModelsRequestRef.current === requestId) {
				setAvailableOpenAiModels([])
				setOpenAiModelsError(error instanceof Error ? error.message : String(error))
			}
		} finally {
			if (openAiModelsRequestRef.current === requestId) {
				setIsRefreshingOpenAiModels(false)
			}
		}
	}, [])

	const debouncedRefreshOpenAiModels = useCallback(
		(baseUrl?: string, apiKey?: string) => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}

			debounceTimerRef.current = setTimeout(() => {
				void refreshOpenAiModels(baseUrl, apiKey)
			}, 500)
		},
		[refreshOpenAiModels],
	)

	useEffect(() => {
		void refreshOpenAiModels(config?.baseUrl, latestOpenAiApiKeyRef.current)
	}, [config?.baseUrl, refreshOpenAiModels])

	const toOpenAiModelInfo = useCallback(
		(modelId: string): ModelInfo => ({
			...openAiModelInfoSafeDefaults,
			name: modelId,
		}),
		[],
	)

	const handleOpenAiModelSelection = useCallback(
		(modelId: string, modelInfo = toOpenAiModelInfo(modelId)) => {
			handleModeFieldChange({ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" }, modelId, currentMode)
			commitOpenAiSelection(modelId, modelInfo)
		},
		[commitOpenAiSelection, currentMode, handleModeFieldChange, toOpenAiModelInfo],
	)

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		canWrite: config !== undefined,
		onApiKeyChange: (apiKey) => {
			latestOpenAiApiKeyRef.current = apiKey
			debouncedRefreshOpenAiModels(latestOpenAiBaseUrlRef.current, apiKey)
		},
		providerName: "OpenAI Compatible",
		write,
	})

	return (
		<div>
			<Tooltip>
				<TooltipTrigger>
					<div className="mb-2.5">
						<div className="flex items-center gap-2 mb-1">
							<span style={{ fontWeight: 500 }}>Base URL</span>
							{remoteConfigSettings?.openAiBaseUrl !== undefined && (
								<i className="codicon codicon-lock text-description text-sm" />
							)}
						</div>
						<DebouncedTextField
							disabled={remoteConfigSettings?.openAiBaseUrl !== undefined}
							initialValue={config?.baseUrl || ""}
							onChange={(value) => {
								if (!config) {
									return
								}

								latestOpenAiBaseUrlRef.current = value
								void write({ baseUrl: value }).catch((error) => handleProviderConfigWriteError("base URL", error))
								debouncedRefreshOpenAiModels(value, latestOpenAiApiKeyRef.current)
							}}
							placeholder={"Enter base URL..."}
							style={{ width: "100%", marginBottom: 10 }}
							type="text"
						/>
					</div>
				</TooltipTrigger>
				<TooltipContent hidden={remoteConfigSettings?.openAiBaseUrl === undefined}>
					This setting is managed by your organization's remote configuration
				</TooltipContent>
			</Tooltip>

			<ApiKeyField initialValue={savedApiKeyMask} onChange={handleApiKeyChange} providerName="OpenAI Compatible" />

			{isRefreshingOpenAiModels && <div role="status">Loading models…</div>}
			{openAiModelsError && <div role="alert">{openAiModelsError}</div>}
			{availableOpenAiModels.length > 0 ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
					<label htmlFor="openai-compatible-model-picker">
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</label>
					<select
						aria-label="Model ID"
						id="openai-compatible-model-picker"
						onChange={(event) => {
							const modelId = event.target.value
							if (modelId === "__custom__") {
								setIsCustomOpenAiModelEntryVisible(true)
								return
							}

							setIsCustomOpenAiModelEntryVisible(false)
							handleOpenAiModelSelection(modelId)
						}}
						style={{ width: "100%" }}
						value={selectedModelId && availableOpenAiModels.includes(selectedModelId) ? selectedModelId : ""}>
						{selectedModelId && !availableOpenAiModels.includes(selectedModelId) && (
							<option value="">{selectedModelId} (not in current list)</option>
						)}
						{availableOpenAiModels.map((modelId) => (
							<option key={modelId} value={modelId}>
								{modelId}
							</option>
						))}
						<option value="__custom__">Use custom model ID…</option>
					</select>

					{(isCustomOpenAiModelEntryVisible ||
						(selectedModelId && !availableOpenAiModels.includes(selectedModelId))) && (
						<DebouncedTextField
							initialValue={selectedModelId || ""}
							onChange={(value) => handleOpenAiModelSelection(value)}
							placeholder={"Enter Model ID..."}
							style={{ width: "100%" }}>
							<span style={{ fontWeight: 500 }}>Custom Model ID</span>
						</DebouncedTextField>
					)}
				</div>
			) : (
				<DebouncedTextField
					initialValue={selectedModelId || ""}
					onChange={(value) => handleOpenAiModelSelection(value)}
					placeholder={"Enter Model ID..."}
					style={{ width: "100%", marginBottom: 10 }}>
					<span style={{ fontWeight: 500 }}>Model ID</span>
				</DebouncedTextField>
			)}

			{/* OpenAI Compatible Custom Headers */}
			{(() => {
				const headers = config?.headers ?? {}
				const headerEntries = Object.entries(headers)

				return (
					<div style={{ marginBottom: 10 }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<Tooltip>
								<TooltipTrigger>
									<div className="flex items-center gap-2">
										<span style={{ fontWeight: 500 }}>Custom Headers</span>
										{remoteConfigSettings?.openAiHeaders !== undefined && (
											<i className="codicon codicon-lock text-description text-sm" />
										)}
									</div>
								</TooltipTrigger>
								<TooltipContent hidden={remoteConfigSettings?.openAiHeaders === undefined}>
									This setting is managed by your organization's remote configuration
								</TooltipContent>
							</Tooltip>
							<VSCodeButton
								disabled={remoteConfigSettings?.openAiHeaders !== undefined}
								onClick={() => {
									const currentHeaders = { ...headers }
									const headerCount = Object.keys(currentHeaders).length
									const newKey = `header${headerCount + 1}`
									currentHeaders[newKey] = ""
									void write({ headers: currentHeaders }).catch((error) =>
										handleProviderConfigWriteError("headers", error),
									)
								}}>
								Add Header
							</VSCodeButton>
						</div>

						<div>
							{headerEntries.map(([key, value], index) => (
								<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={key}
										onChange={(newValue) => {
											const currentHeaders = config?.headers ?? {}
											if (newValue && newValue !== key) {
												const { [key]: _, ...rest } = currentHeaders
												void write({
													headers: {
														...rest,
														[newValue]: value,
													},
												}).catch((error) => handleProviderConfigWriteError("headers", error))
											}
										}}
										placeholder="Header name"
										style={{ width: "40%" }}
									/>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={value}
										onChange={(newValue) => {
											void write({
												headers: {
													...(config?.headers ?? {}),
													[key]: newValue,
												},
											}).catch((error) => handleProviderConfigWriteError("headers", error))
										}}
										placeholder="Header value"
										style={{ width: "40%" }}
									/>
									<VSCodeButton
										appearance="secondary"
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										onClick={() => {
											const { [key]: _, ...rest } = config?.headers ?? {}
											void write({ headers: rest }).catch((error) =>
												handleProviderConfigWriteError("headers", error),
											)
										}}>
										Remove
									</VSCodeButton>
								</div>
							))}
						</div>
					</div>
				)
			})()}

			{remoteConfigSettings?.azureApiVersion !== undefined ? (
				<Tooltip>
					<TooltipTrigger>
						<BaseUrlField
							disabled={true}
							initialValue={apiConfiguration?.azureApiVersion}
							label="Set Azure API version"
							onChange={(value) => handleFieldChange("azureApiVersion", value)}
							placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
							showLockIcon={true}
						/>
					</TooltipTrigger>
					<TooltipContent>This setting is managed by your organization's remote configuration</TooltipContent>
				</Tooltip>
			) : (
				<BaseUrlField
					initialValue={apiConfiguration?.azureApiVersion}
					label="Set Azure API version"
					onChange={(value) => handleFieldChange("azureApiVersion", value)}
					placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
				/>
			)}

			<VSCodeCheckbox
				checked={apiConfiguration?.azureIdentity || false}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					return handleFieldChange("azureIdentity", isChecked)
				}}>
				Use Azure Identity Authentication
			</VSCodeCheckbox>

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
					}}
				/>
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
						checked={!!openAiModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = openAiModelInfo ? { ...openAiModelInfo } : { ...openAiModelInfoSafeDefaults }
							modelInfo.supportsImages = isChecked
							handleOpenAiModelInfoChange(modelInfo)
						}}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!openAiModelInfo?.isR1FormatRequired}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = openAiModelInfo ? { ...openAiModelInfo } : { ...openAiModelInfoSafeDefaults }
							modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

							handleOpenAiModelInfoChange(modelInfo)
						}}>
						Enable R1 messages format
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								openAiModelInfo?.contextWindow
									? openAiModelInfo.contextWindow.toString()
									: (openAiModelInfoSafeDefaults.contextWindow?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? { ...openAiModelInfo } : { ...openAiModelInfoSafeDefaults }
								modelInfo.contextWindow = Number(value)
								handleOpenAiModelInfoChange(modelInfo)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								openAiModelInfo?.maxTokens
									? openAiModelInfo.maxTokens.toString()
									: (openAiModelInfoSafeDefaults.maxTokens?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? { ...openAiModelInfo } : { ...openAiModelInfoSafeDefaults }
								modelInfo.maxTokens = Number(value)
								handleOpenAiModelInfoChange(modelInfo)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								openAiModelInfo?.inputPrice
									? openAiModelInfo.inputPrice.toString()
									: (openAiModelInfoSafeDefaults.inputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? { ...openAiModelInfo } : { ...openAiModelInfoSafeDefaults }
								modelInfo.inputPrice = parsePrice(value, openAiModelInfoSafeDefaults.inputPrice ?? 0)
								handleOpenAiModelInfoChange(modelInfo)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								openAiModelInfo?.outputPrice
									? openAiModelInfo.outputPrice.toString()
									: (openAiModelInfoSafeDefaults.outputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? { ...openAiModelInfo } : { ...openAiModelInfoSafeDefaults }
								modelInfo.outputPrice = parsePrice(value, openAiModelInfoSafeDefaults.outputPrice ?? 0)
								handleOpenAiModelInfoChange(modelInfo)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								openAiModelInfo?.temperature
									? openAiModelInfo.temperature.toString()
									: (openAiModelInfoSafeDefaults.temperature?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? { ...openAiModelInfo } : { ...openAiModelInfoSafeDefaults }
								modelInfo.temperature = parsePrice(value, openAiModelInfoSafeDefaults.temperature ?? 0)
								handleOpenAiModelInfoChange(modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
					</div>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts, so behavior can vary across
					models. Less capable models may not work as expected.)
				</span>
			</p>

			{showModelOptions && (
				<>
					<ReasoningEffortSelector
						currentMode={currentMode}
						defaultEffort="none"
						onEffortChange={(effort) => {
							void write({
								reasoning: {
									enabled: effort !== "none",
									effort: effort !== "none" ? effort : undefined,
								},
							}).catch((err) => console.error("Failed to update OpenAI Compatible reasoning effort:", err))
						}}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
