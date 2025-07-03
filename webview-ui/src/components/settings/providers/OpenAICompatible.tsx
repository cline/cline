import { ApiConfiguration, azureOpenAiDefaultApiVersion, openAiModelInfoSaneDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/models"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The OpenAI Compatible provider configuration component
 */
export const OpenAICompatibleProvider = ({ showModelOptions, isPopup }: OpenAICompatibleProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

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
			<DebouncedTextField
				initialValue={apiConfiguration?.openAiBaseUrl || ""}
				onChange={(value) => {
					handleFieldChange("openAiBaseUrl", value)
					debouncedRefreshOpenAiModels(value, apiConfiguration?.openAiApiKey)
				}}
				style={{ width: "100%", marginBottom: 10 }}
				type="url"
				placeholder={"Enter base URL..."}>
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</DebouncedTextField>

			<ApiKeyField
				initialValue={apiConfiguration?.openAiApiKey || ""}
				onChange={(value) => {
					handleFieldChange("openAiApiKey", value)
					debouncedRefreshOpenAiModels(apiConfiguration?.openAiBaseUrl, value)
				}}
				providerName="OpenAI Compatible"
			/>

			<DebouncedTextField
				initialValue={apiConfiguration?.openAiModelId || ""}
				onChange={(value) => handleFieldChange("openAiModelId", value)}
				style={{ width: "100%", marginBottom: 10 }}
				placeholder={"Enter Model ID..."}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

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
							{headerEntries.map(([key, value], index) => (
								<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
									<DebouncedTextField
										initialValue={key}
										style={{ width: "40%" }}
										placeholder="Header name"
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
									/>
									<DebouncedTextField
										initialValue={value}
										style={{ width: "40%" }}
										placeholder="Header value"
										onChange={(newValue) => {
											handleFieldChange("openAiHeaders", {
												...(apiConfiguration?.openAiHeaders ?? {}),
												[key]: newValue,
											})
										}}
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
				onChange={(value) => handleFieldChange("azureApiVersion", value)}
				label="Set Azure API version"
				placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
			/>

			<div
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}
				onClick={() => setModelConfigurationSelected((val) => !val)}>
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
						checked={!!apiConfiguration?.openAiModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = apiConfiguration?.openAiModelInfo
								? apiConfiguration.openAiModelInfo
								: { ...openAiModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked
							handleFieldChange("openAiModelInfo", modelInfo)
						}}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!apiConfiguration?.openAiModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = apiConfiguration?.openAiModelInfo
								? apiConfiguration.openAiModelInfo
								: { ...openAiModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked
							handleFieldChange("openAiModelInfo", modelInfo)
						}}>
						Supports browser use
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!apiConfiguration?.openAiModelInfo?.isR1FormatRequired}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = apiConfiguration?.openAiModelInfo
								? apiConfiguration.openAiModelInfo
								: { ...openAiModelInfoSaneDefaults }
							modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

							handleFieldChange("openAiModelInfo", modelInfo)
						}}>
						Enable R1 messages format
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								apiConfiguration?.openAiModelInfo?.contextWindow
									? apiConfiguration.openAiModelInfo.contextWindow.toString()
									: (openAiModelInfoSaneDefaults.contextWindow?.toString() ?? "")
							}
							style={{ flex: 1 }}
							onChange={(value) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(value)
								handleFieldChange("openAiModelInfo", modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								apiConfiguration?.openAiModelInfo?.maxTokens
									? apiConfiguration.openAiModelInfo.maxTokens.toString()
									: (openAiModelInfoSaneDefaults.maxTokens?.toString() ?? "")
							}
							style={{ flex: 1 }}
							onChange={(value) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.maxTokens = Number(value)
								handleFieldChange("openAiModelInfo", modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								apiConfiguration?.openAiModelInfo?.inputPrice
									? apiConfiguration.openAiModelInfo.inputPrice.toString()
									: (openAiModelInfoSaneDefaults.inputPrice?.toString() ?? "")
							}
							style={{ flex: 1 }}
							onChange={(value) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.inputPrice = Number(value)
								handleFieldChange("openAiModelInfo", modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								apiConfiguration?.openAiModelInfo?.outputPrice
									? apiConfiguration.openAiModelInfo.outputPrice.toString()
									: (openAiModelInfoSaneDefaults.outputPrice?.toString() ?? "")
							}
							style={{ flex: 1 }}
							onChange={(value) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.outputPrice = Number(value)
								handleFieldChange("openAiModelInfo", modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								apiConfiguration?.openAiModelInfo?.temperature
									? apiConfiguration.openAiModelInfo.temperature.toString()
									: (openAiModelInfoSaneDefaults.temperature?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }

								const shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

								modelInfo.temperature =
									value === ""
										? openAiModelInfoSaneDefaults.temperature
										: shouldPreserveFormat
											? (value as any)
											: parseFloat(value)

								handleFieldChange("openAiModelInfo", modelInfo)
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
				<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
			)}
		</div>
	)
}
