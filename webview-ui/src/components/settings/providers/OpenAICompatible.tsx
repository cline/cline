import { azureOpenAiDefaultApiVersion, openAiModelInfoSaneDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../OpenRouterModelPicker"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
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
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [modelSearchTerm, setModelSearchTerm] = useState("")

	// Local minimal preset + matcher (kept scoped to this file to avoid new shared files)
	type OpenAICompatiblePresetLocal = {
		provider: "openai"
		defaults?: { openAiBaseUrl?: string }
		apiKeyLabel?: string
	}

	const OPENAI_COMPATIBLE_PRESETS_LOCAL: Readonly<Record<string, OpenAICompatiblePresetLocal>> = {
		portkey: {
			provider: "openai",
			defaults: { openAiBaseUrl: "https://api.portkey.ai/v1" },
			apiKeyLabel: "Your Portkey",
		},
	}

	function matchPresetFromBaseUrlLocal(openAiBaseUrl?: string): string | null {
		const base = (openAiBaseUrl || "").trim()
		if (!base) {
			return null
		}
		try {
			const input = new URL(base)
			const inputHost = input.hostname.toLowerCase()
			const inputPath = input.pathname || "/"

			for (const [key, preset] of Object.entries(OPENAI_COMPATIBLE_PRESETS_LOCAL)) {
				const presetUrl = preset.defaults?.openAiBaseUrl
				if (!presetUrl) {
					continue
				}
				try {
					const presetParsed = new URL(presetUrl)
					const presetHost = presetParsed.hostname.toLowerCase()
					const presetPath = presetParsed.pathname || "/"

					const isSameHost = inputHost === presetHost
					const isSubdomain = inputHost.endsWith(`.${presetHost}`)
					const isPathCompatible = presetPath === "/" || inputPath.startsWith(presetPath)

					if ((isSameHost || isSubdomain) && isPathCompatible) {
						return key
					}
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}
		return null
	}

	// Derive a friendlier API key label using local preset matcher
	const apiKeyProviderName = useMemo(() => {
		const key = matchPresetFromBaseUrlLocal(apiConfiguration?.openAiBaseUrl)
		if (key && OPENAI_COMPATIBLE_PRESETS_LOCAL[key]?.apiKeyLabel) {
			return OPENAI_COMPATIBLE_PRESETS_LOCAL[key].apiKeyLabel as string
		}
		return "OpenAI Compatible"
	}, [apiConfiguration?.openAiBaseUrl])

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Get mode-specific fields
	const { openAiModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)

	// Debounced function to refresh OpenAI models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
	const [availableModels, setAvailableModels] = useState<string[]>([])

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
				)
					.then((resp) => {
						const fetched = resp?.values ?? []
						setAvailableModels(fetched)
						// If we fetched models and none is selected yet, prefill with the first.
						if (fetched.length > 0 && !selectedModelId) {
							handleModeFieldChange(
								{ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" },
								fetched[0],
								currentMode,
							)
						}
					})
					.catch((error) => {
						console.error("Failed to refresh OpenAI models:", error)
						setAvailableModels([])
					})
			}, 500)
		} else {
			setAvailableModels([])
		}
	}, [])

	// (Manual entry branch removed) – searchable dropdown supports custom model IDs directly

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.openAiBaseUrl || ""}
				onChange={(value) => {
					handleFieldChange("openAiBaseUrl", value)
					debouncedRefreshOpenAiModels(value, apiConfiguration?.openAiApiKey)
				}}
				placeholder={"Enter base URL..."}
				style={{ width: "100%", marginBottom: 10 }}
				type="url">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</DebouncedTextField>

			<ApiKeyField
				initialValue={apiConfiguration?.openAiApiKey || ""}
				onChange={(value) => {
					handleFieldChange("openAiApiKey", value)
					debouncedRefreshOpenAiModels(apiConfiguration?.openAiBaseUrl, value)
				}}
				providerName={apiKeyProviderName}
			/>

			{/* Model ID */}
			<div style={{ width: "100%", marginBottom: 10 }}>
				<label htmlFor="openai-compatible-model-id">
					<span style={{ fontWeight: 500 }}>Model ID</span>
				</label>
				{(() => {
					const trimmed = modelSearchTerm.trim()
					const filteredModels = trimmed
						? availableModels.filter((m) => m.toLowerCase().includes(trimmed.toLowerCase()))
						: availableModels
					const exactMatch =
						trimmed.length > 0 && availableModels.some((m) => m.toLowerCase() === trimmed.toLowerCase())
					const showCustomOption = trimmed.length > 0 && !exactMatch
					// Ensure currently selected value stays visible even when filtered out
					const displayModels =
						selectedModelId && !filteredModels.includes(selectedModelId)
							? [selectedModelId, ...filteredModels]
							: filteredModels
					const dropdownValue = selectedModelId && displayModels.includes(selectedModelId) ? selectedModelId : ""
					return (
						<DropdownContainer className="dropdown-container" zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX + 3}>
							<VSCodeTextField
								onInput={(e) => setModelSearchTerm((e.target as HTMLInputElement).value || "")}
								placeholder="Search models..."
								style={{ width: "100%", marginBottom: 6 }}
								value={modelSearchTerm}
							/>
							{showCustomOption && (
								<p style={{ fontSize: "12px", margin: "0 0 6px 0", color: getAsVar(VSC_DESCRIPTION_FOREGROUND) }}>
									No matches found. Select the option below to use "{trimmed}" as a custom model ID.
								</p>
							)}
							<VSCodeDropdown
								id="openai-compatible-model-id"
								onChange={(e: any) => {
									const value = e.target.value
									// Clear search after selection to avoid stale filters
									setModelSearchTerm("")
									handleModeFieldChange(
										{ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" },
										value,
										currentMode,
									)
								}}
								style={{ width: "100%", marginBottom: 10 }}
								value={dropdownValue}>
								<VSCodeOption value="">Select a model...</VSCodeOption>
								{displayModels.map((m) => (
									<VSCodeOption key={m} value={m}>
										{m}
									</VSCodeOption>
								))}
								{showCustomOption && (
									<VSCodeOption key={`__custom__${trimmed}`} value={trimmed}>
										Use "{trimmed}" (custom)
									</VSCodeOption>
								)}
							</VSCodeDropdown>
						</DropdownContainer>
					)
				})()}
			</div>

			{/* OpenAI Compatible Custom Headers */}
			{(() => {
				const headerEntries = Object.entries(apiConfiguration?.openAiHeaders ?? {})
				return (
					<div style={{ marginBottom: 10 }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<span style={{ fontWeight: 500 }}>Custom Headers</span>
							<VSCodeButton
								onClick={() => {
									const currentHeaders = { ...(apiConfiguration?.openAiHeaders || {}) }
									const headerCount = Object.keys(currentHeaders).length
									const newKey = `header${headerCount + 1}`
									currentHeaders[newKey] = ""
									handleFieldChange("openAiHeaders", currentHeaders)
								}}>
								Add Header
							</VSCodeButton>
						</div>
						<div>
							{headerEntries.map(([key, value]) => (
								<div key={key} style={{ display: "flex", gap: 5, marginTop: 5 }}>
									<DebouncedTextField
										initialValue={key}
										onChange={(newValue) => {
											const currentHeaders = apiConfiguration?.openAiHeaders ?? {}
											if (newValue && newValue !== key) {
												const { [key]: _, ...rest } = currentHeaders
												handleFieldChange("openAiHeaders", {
													...rest,
													[newValue]: value,
												})
											}
										}}
										placeholder="Header name"
										style={{ width: "40%" }}
									/>
									<DebouncedTextField
										initialValue={value}
										onChange={(newValue) => {
											handleFieldChange("openAiHeaders", {
												...(apiConfiguration?.openAiHeaders ?? {}),
												[key]: newValue,
											})
										}}
										placeholder="Header value"
										style={{ width: "40%" }}
									/>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											const { [key]: _, ...rest } = apiConfiguration?.openAiHeaders ?? {}
											handleFieldChange("openAiHeaders", rest)
										}}>
										Remove
									</VSCodeButton>
								</div>
							))}
						</div>
					</div>
				)
			})()}

			<BaseUrlField
				initialValue={apiConfiguration?.azureApiVersion}
				label="Set Azure API version"
				onChange={(value) => handleFieldChange("azureApiVersion", value)}
				placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
			/>

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
						checked={!!openAiModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked
							handleModeFieldChange(
								{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
								modelInfo,
								currentMode,
							)
						}}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!openAiModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked
							handleModeFieldChange(
								{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
								modelInfo,
								currentMode,
							)
						}}>
						Supports browser use
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!openAiModelInfo?.isR1FormatRequired}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }
							modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

							handleModeFieldChange(
								{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
								modelInfo,
								currentMode,
							)
						}}>
						Enable R1 messages format
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								openAiModelInfo?.contextWindow
									? openAiModelInfo.contextWindow.toString()
									: (openAiModelInfoSaneDefaults.contextWindow?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(value)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								openAiModelInfo?.maxTokens
									? openAiModelInfo.maxTokens.toString()
									: (openAiModelInfoSaneDefaults.maxTokens?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.maxTokens = Number(value)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
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
								openAiModelInfo?.inputPrice
									? openAiModelInfo.inputPrice.toString()
									: (openAiModelInfoSaneDefaults.inputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.inputPrice = Number(value)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								openAiModelInfo?.outputPrice
									? openAiModelInfo.outputPrice.toString()
									: (openAiModelInfoSaneDefaults.outputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.outputPrice = Number(value)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
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
									: (openAiModelInfoSaneDefaults.temperature?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiModelInfo ? openAiModelInfo : { ...openAiModelInfoSaneDefaults }

								const shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

								modelInfo.temperature =
									value === ""
										? openAiModelInfoSaneDefaults.temperature
										: shouldPreserveFormat
											? (value as any)
											: parseFloat(value)

								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
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
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
