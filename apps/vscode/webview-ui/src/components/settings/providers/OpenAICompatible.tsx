import { TooltipTrigger } from "@radix-ui/react-tooltip"
import {
	azureOpenAiDefaultApiVersion,
	type ModelInfo,
	type OpenAiCompatibleModelInfo,
	openAiModelInfoSafeDefaults,
} from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip } from "@/components/ui/tooltip"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	providerId: string
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const finiteNumberOrUndefined = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined

const positiveFiniteNumberOrUndefined = (value: unknown): number | undefined => {
	const numberValue = finiteNumberOrUndefined(value)
	return numberValue !== undefined && numberValue > 0 ? numberValue : undefined
}

const finiteNumberOrZero = (value: unknown): number => finiteNumberOrUndefined(value) ?? 0

const numberInputValue = (value: unknown, fallback: unknown): string =>
	(finiteNumberOrUndefined(value) ?? finiteNumberOrUndefined(fallback) ?? 0).toString()

const unsetSentinelNumberInputValue = (value: unknown, fallback: unknown): string => {
	const numberValue = finiteNumberOrUndefined(value) ?? finiteNumberOrUndefined(fallback)
	return numberValue !== undefined && numberValue >= 0 ? numberValue.toString() : ""
}

const parseNumberInput = (value: string, fallback: unknown): number => {
	const trimmed = value.trim()
	if (!trimmed || trimmed === ".") {
		return finiteNumberOrZero(fallback)
	}
	const parsed = Number.parseFloat(trimmed)
	return Number.isFinite(parsed) ? parsed : finiteNumberOrZero(fallback)
}

/**
 * The OpenAI Compatible provider configuration component
 */
export const OpenAICompatibleProvider = ({
	providerId,
	showModelOptions,
	isPopup,
	currentMode,
}: OpenAICompatibleProviderProps) => {
	const { config, write, commitSelection } = useProviderConfig(providerId)

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isCustomOpenAiModelEntryVisible, setIsCustomOpenAiModelEntryVisible] = useState(false)
	const [availableOpenAiModels, setAvailableOpenAiModels] = useState<string[]>([])
	const [isRefreshingOpenAiModels, setIsRefreshingOpenAiModels] = useState(false)
	const [openAiModelsError, setOpenAiModelsError] = useState<string | undefined>(undefined)
	const latestOpenAiBaseUrlRef = useRef(config?.baseUrl || "")
	const latestOpenAiApiKeyRef = useRef("")
	const openAiModelsRequestRef = useRef(0)

	useEffect(() => {
		latestOpenAiBaseUrlRef.current = config?.baseUrl || ""
	}, [config?.baseUrl])

	const handleProviderConfigWriteError = useCallback((fieldName: string, error: unknown) => {
		console.error(`Failed to update OpenAI Compatible ${fieldName}:`, error)
	}, [])

	const handleAzureApiVersionChange = useCallback(
		(value: string) => {
			void write({ azure: { apiVersion: value } }).catch((error) =>
				handleProviderConfigWriteError("Azure API version", error),
			)
		},
		[handleProviderConfigWriteError, write],
	)

	const handleAzureIdentityChange = useCallback(
		(enabled: boolean) => {
			void write({ azure: { useIdentity: enabled } }).catch((error) =>
				handleProviderConfigWriteError("Azure identity authentication", error),
			)
		},
		[handleProviderConfigWriteError, write],
	)

	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const selectedModelId = committedSelection?.modelId ?? ""
	const selectedModelInfo = committedSelection?.modelInfo
		? fromProtobufModelInfo(committedSelection.modelInfo)
		: openAiModelInfoSafeDefaults
	// The Model Configuration section reads/writes the resolved model info.
	// OpenAiCompatibleModelInfo only adds optional fields over ModelInfo, so a
	// resolved ModelInfo satisfies it structurally.
	const openAiModelInfo: OpenAiCompatibleModelInfo = {
		...selectedModelInfo,
		...(config?.contextWindow !== undefined ? { contextWindow: Number(config.contextWindow) } : {}),
		...(config?.maxTokens !== undefined ? { maxTokens: Number(config.maxTokens) } : {}),
		...(config?.temperature !== undefined ? { temperature: config.temperature } : {}),
		...(config?.pricing?.input !== undefined ? { inputPrice: config.pricing.input } : {}),
		...(config?.pricing?.output !== undefined ? { outputPrice: config.pricing.output } : {}),
		...(config?.pricing?.cacheRead !== undefined ? { cacheReadsPrice: config.pricing.cacheRead } : {}),
		...(config?.pricing?.cacheWrite !== undefined ? { cacheWritesPrice: config.pricing.cacheWrite } : {}),
	}

	const commitOpenAiSelection = useCallback(
		(modelId: string, modelInfo = openAiModelInfo ?? openAiModelInfoSafeDefaults) => {
			if (!modelId.trim()) {
				return
			}

			void commitSelection(currentMode, {
				providerId,
				modelId,
				modelInfo: {
					...modelInfo,
					supportsPromptCache: modelInfo.supportsPromptCache ?? openAiModelInfoSafeDefaults.supportsPromptCache,
				},
			}).catch((error) => handleProviderConfigWriteError("model selection", error))
		},
		[commitSelection, currentMode, handleProviderConfigWriteError, openAiModelInfo, providerId],
	)

	const handleOpenAiModelInfoChange = useCallback(
		(modelInfo: OpenAiCompatibleModelInfo) => {
			commitOpenAiSelection(selectedModelId || "", modelInfo)
			void write({
				contextWindow: positiveFiniteNumberOrUndefined(modelInfo.contextWindow),
				maxTokens: finiteNumberOrUndefined(modelInfo.maxTokens),
				temperature: finiteNumberOrUndefined(modelInfo.temperature),
				pricing: {
					input: finiteNumberOrZero(modelInfo.inputPrice),
					output: finiteNumberOrZero(modelInfo.outputPrice),
					cacheRead: finiteNumberOrZero(modelInfo.cacheReadsPrice),
					cacheWrite: finiteNumberOrZero(modelInfo.cacheWritesPrice),
				},
			}).catch((error) => handleProviderConfigWriteError("model configuration", error))
		},
		[commitOpenAiSelection, handleProviderConfigWriteError, selectedModelId, write],
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
			...(openAiModelInfo ?? {}),
			name: modelId,
			supportsPromptCache: openAiModelInfo?.supportsPromptCache ?? openAiModelInfoSafeDefaults.supportsPromptCache,
		}),
		[openAiModelInfo],
	)

	const handleOpenAiModelSelection = useCallback(
		(modelId: string, modelInfo = toOpenAiModelInfo(modelId)) => {
			commitOpenAiSelection(modelId, modelInfo)
		},
		[commitOpenAiSelection, toOpenAiModelInfo],
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
						</div>
						<DebouncedTextField
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
			</Tooltip>

			<ApiKeyField initialValue={savedApiKeyMask} onChange={handleApiKeyChange} providerName="OpenAI Compatible" />

			{isRefreshingOpenAiModels && <div role="status">Loading models…</div>}
			{openAiModelsError && <div role="alert">{openAiModelsError}</div>}
			{availableOpenAiModels.length > 0 ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
						marginBottom: 10,
					}}>
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
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}>
							<Tooltip>
								<TooltipTrigger>
									<div className="flex items-center gap-2">
										<span style={{ fontWeight: 500 }}>Custom Headers</span>
									</div>
								</TooltipTrigger>
							</Tooltip>
							<VSCodeButton
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

			<BaseUrlField
				initialValue={config?.azure?.apiVersion}
				label="Set Azure API version"
				onChange={handleAzureApiVersionChange}
				placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
			/>

			<VSCodeCheckbox
				checked={config?.azure?.useIdentity || false}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					handleAzureIdentityChange(isChecked)
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
							commitOpenAiSelection(selectedModelId || "", { ...openAiModelInfo, supportsImages: isChecked })
						}}>
						Supports Images
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={numberInputValue(
								openAiModelInfo?.contextWindow,
								openAiModelInfoSafeDefaults.contextWindow,
							)}
							onChange={(value) =>
								handleOpenAiModelInfoChange({
									...openAiModelInfo,
									contextWindow: parseNumberInput(value, openAiModelInfoSafeDefaults.contextWindow),
								})
							}
							placeholder={openAiModelInfoSafeDefaults.contextWindow?.toString()}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={unsetSentinelNumberInputValue(
								openAiModelInfo?.maxTokens,
								openAiModelInfoSafeDefaults.maxTokens,
							)}
							onChange={(value) =>
								handleOpenAiModelInfoChange({
									...openAiModelInfo,
									maxTokens: parseNumberInput(value, openAiModelInfoSafeDefaults.maxTokens),
								})
							}
							placeholder="Not set"
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={numberInputValue(openAiModelInfo?.inputPrice, openAiModelInfoSafeDefaults.inputPrice)}
							onChange={(value) =>
								handleOpenAiModelInfoChange({
									...openAiModelInfo,
									inputPrice: parseNumberInput(value, openAiModelInfoSafeDefaults.inputPrice),
								})
							}
							placeholder={openAiModelInfoSafeDefaults.inputPrice?.toString()}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={numberInputValue(openAiModelInfo?.outputPrice, openAiModelInfoSafeDefaults.outputPrice)}
							onChange={(value) =>
								handleOpenAiModelInfoChange({
									...openAiModelInfo,
									outputPrice: parseNumberInput(value, openAiModelInfoSafeDefaults.outputPrice),
								})
							}
							placeholder={openAiModelInfoSafeDefaults.outputPrice?.toString()}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={unsetSentinelNumberInputValue(
								openAiModelInfo?.temperature,
								openAiModelInfoSafeDefaults.temperature,
							)}
							onChange={(value) =>
								handleOpenAiModelInfoChange({
									...openAiModelInfo,
									temperature: parseNumberInput(value, openAiModelInfoSafeDefaults.temperature),
								})
							}
							placeholder="Not set">
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
									effort,
								},
							}).catch((err) => console.error("Failed to update OpenAI Compatible reasoning effort:", err))
						}}
						persistToApiConfiguration={false}
						value={(config?.reasoning?.effort as any) ?? "none"}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
