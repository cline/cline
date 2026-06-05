import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip"
import { azureOpenAiDefaultApiVersion, openAiModelInfoSafeDefaults } from "@shared/api"
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
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "../utils/apiKeyMasking"
import { parsePrice } from "../utils/pricingUtils"
import { getModeSpecificFields, supportsReasoningEffortForModelId } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

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
	const latestOpenAiBaseUrlRef = useRef(config?.baseUrl || "")
	const latestOpenAiApiKeyRef = useRef(apiConfiguration?.openAiApiKey || "")
	const savedApiKeyMask = getSavedApiKeyMask(config?.apiKeyLength)

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
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId, true)

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

	const debouncedRefreshOpenAiModels = useCallback((baseUrl?: string, apiKey?: string) => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		if (baseUrl && apiKey) {
			debounceTimerRef.current = setTimeout(() => {
				ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						baseUrl,
						apiKey,
					}),
				).catch((error) => {
					console.error("Failed to refresh OpenAI models:", error)
				})
			}, 500)
		}
	}, [])

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

			<ApiKeyField
				initialValue={savedApiKeyMask}
				onChange={(value) => {
					if (!config) {
						return
					}

					const apiKey = sanitizeMaskedApiKeyInput(value, savedApiKeyMask)

					if (apiKey === undefined) {
						return
					}

					latestOpenAiApiKeyRef.current = apiKey
					void write({ apiKey }).catch((error) => handleProviderConfigWriteError("API key", error))
					debouncedRefreshOpenAiModels(latestOpenAiBaseUrlRef.current, apiKey)
				}}
				providerName="OpenAI Compatible"
			/>

			<DebouncedTextField
				initialValue={selectedModelId || ""}
				onChange={(value) => {
					handleModeFieldChange({ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" }, value, currentMode)
					commitOpenAiSelection(value)
				}}
				placeholder={"Enter Model ID..."}
				style={{ width: "100%", marginBottom: 10 }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

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
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
