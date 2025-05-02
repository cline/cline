import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField, VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Fragment, useState } from "react"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The OpenAI Compatible provider configuration component
 */
export const OpenAICompatibleProvider = ({
	apiConfiguration,
	handleInputChange,
	showModelOptions,
	isPopup,
}: OpenAICompatibleProviderProps) => {
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azureApiVersion)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Create a wrapper for handling field changes more directly
	const handleFieldChange = (field: keyof ApiConfiguration) => (value: any) => {
		handleInputChange(field)({ target: { value } })
	}

	const handleHeadersChange = (headers: Record<string, string>) => {
		handleFieldChange("openAiHeaders")(headers)
	}

	const handleModelInfoChange = (modelInfo: any) => {
		handleFieldChange("openAiModelInfo")(modelInfo)
	}

	// Custom Headers section
	const OpenAICustomHeaders = () => {
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
							handleHeadersChange(currentHeaders)
						}}>
						Add Header
					</VSCodeButton>
				</div>
				<div>
					{headerEntries.map(([key, value], index) => (
						<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
							<VSCodeTextField
								value={key}
								style={{ width: "40%" }}
								placeholder="Header name"
								onInput={(e: any) => {
									const currentHeaders = apiConfiguration?.openAiHeaders ?? {}
									const newValue = e.target.value
									if (newValue && newValue !== key) {
										const { [key]: _, ...rest } = currentHeaders
										handleHeadersChange({
											...rest,
											[newValue]: value,
										})
									}
								}}
							/>
							<VSCodeTextField
								value={value}
								style={{ width: "40%" }}
								placeholder="Header value"
								onInput={(e: any) => {
									handleHeadersChange({
										...(apiConfiguration?.openAiHeaders ?? {}),
										[key]: e.target.value,
									})
								}}
							/>
							<VSCodeButton
								appearance="secondary"
								onClick={() => {
									const { [key]: _, ...rest } = apiConfiguration?.openAiHeaders ?? {}
									handleHeadersChange(rest)
								}}>
								Remove
							</VSCodeButton>
						</div>
					))}
				</div>
			</div>
		)
	}

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.openAiBaseUrl || ""}
				style={{ width: "100%", marginBottom: 10 }}
				type="url"
				onInput={handleInputChange("openAiBaseUrl")}
				placeholder={"Enter base URL..."}>
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.openAiApiKey || ""}
				style={{ width: "100%", marginBottom: 10 }}
				type="password"
				onInput={handleInputChange("openAiApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.openAiModelId || ""}
				style={{ width: "100%", marginBottom: 10 }}
				onInput={handleInputChange("openAiModelId")}
				placeholder={"Enter Model ID..."}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>

			{/* Custom Headers section */}
			<OpenAICustomHeaders />

			{/* Azure API Version option */}
			<VSCodeCheckbox
				checked={azureApiVersionSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					setAzureApiVersionSelected(isChecked)
					if (!isChecked) {
						handleFieldChange("azureApiVersion")("")
					}
				}}>
				Set Azure API version
			</VSCodeCheckbox>

			{azureApiVersionSelected && (
				<VSCodeTextField
					value={apiConfiguration?.azureApiVersion || ""}
					style={{ width: "100%", marginTop: 3 }}
					onInput={handleInputChange("azureApiVersion")}
					placeholder={"Default: 2023-05-15"}
				/>
			)}

			{/* Model Configuration section */}
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
								? { ...apiConfiguration.openAiModelInfo }
								: { contextWindow: 16000, maxTokens: 4000, inputPrice: 0.01, outputPrice: 0.03 }
							// Use type assertion to handle optional properties
							;(modelInfo as any).supportsImages = isChecked
							handleModelInfoChange(modelInfo)
						}}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!(apiConfiguration?.openAiModelInfo as any)?.supportsBrowserUse}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = apiConfiguration?.openAiModelInfo
								? { ...apiConfiguration.openAiModelInfo }
								: { contextWindow: 16000, maxTokens: 4000, inputPrice: 0.01, outputPrice: 0.03 }
							// Use type assertion to handle optional properties
							;(modelInfo as any).supportsBrowserUse = isChecked
							handleModelInfoChange(modelInfo)
						}}>
						Supports browser use
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!apiConfiguration?.openAiModelInfo?.isR1FormatRequired}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = apiConfiguration?.openAiModelInfo
								? { ...apiConfiguration.openAiModelInfo }
								: { contextWindow: 16000, maxTokens: 4000, inputPrice: 0.01, outputPrice: 0.03 }
							modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }
							handleModelInfoChange(modelInfo)
						}}>
						Enable R1 messages format
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.contextWindow
									? apiConfiguration.openAiModelInfo.contextWindow.toString()
									: "16000"
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? { ...apiConfiguration.openAiModelInfo }
									: { contextWindow: 16000, maxTokens: 4000, inputPrice: 0.01, outputPrice: 0.03 }
								modelInfo.contextWindow = Number(input.target.value)
								handleModelInfoChange(modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</VSCodeTextField>

						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.maxTokens
									? apiConfiguration.openAiModelInfo.maxTokens.toString()
									: "4000"
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? { ...apiConfiguration.openAiModelInfo }
									: { contextWindow: 16000, maxTokens: 4000, inputPrice: 0.01, outputPrice: 0.03 }
								modelInfo.maxTokens = Number(input.target.value)
								handleModelInfoChange(modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</VSCodeTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.inputPrice
									? apiConfiguration.openAiModelInfo.inputPrice.toString()
									: "0.01"
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? { ...apiConfiguration.openAiModelInfo }
									: { contextWindow: 16000, maxTokens: 4000, inputPrice: 0.01, outputPrice: 0.03 }
								modelInfo.inputPrice = Number(input.target.value)
								handleModelInfoChange(modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</VSCodeTextField>

						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.outputPrice
									? apiConfiguration.openAiModelInfo.outputPrice.toString()
									: "0.03"
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? { ...apiConfiguration.openAiModelInfo }
									: { contextWindow: 16000, maxTokens: 4000, inputPrice: 0.01, outputPrice: 0.03 }
								modelInfo.outputPrice = Number(input.target.value)
								handleModelInfoChange(modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</VSCodeTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.temperature !== undefined
									? apiConfiguration.openAiModelInfo.temperature.toString()
									: "0.7"
							}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? { ...apiConfiguration.openAiModelInfo }
									: {
											contextWindow: 16000,
											maxTokens: 4000,
											inputPrice: 0.01,
											outputPrice: 0.03,
											temperature: 0.7,
										}

								// Check if the input ends with a decimal point or has trailing zeros after decimal
								const value = input.target.value
								const shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

								modelInfo.temperature =
									value === ""
										? 0.7
										: shouldPreserveFormat
											? value // Keep as string to preserve decimal format
											: parseFloat(value)

								handleModelInfoChange(modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</VSCodeTextField>
					</div>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-errorForeground)",
				}}>
				<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models. Less
				capable models may not work as expected.
			</p>

			{showModelOptions && (
				<ModelInfoView
					selectedModelId={selectedModelId || "custom-model"}
					modelInfo={selectedModelInfo}
					isPopup={isPopup}
				/>
			)}
		</div>
	)
}
