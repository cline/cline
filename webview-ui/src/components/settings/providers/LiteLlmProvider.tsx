import { useState } from "react"
import { liteLlmModelInfoSaneDefaults } from "@shared/api"
import { VSCodeTextField, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { ModelInfoView } from "../common/ModelInfoView"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the LiteLlmProvider component
 */
interface LiteLlmProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The LiteLLM provider configuration component
 */
export const LiteLlmProvider = ({ showModelOptions, isPopup }: LiteLlmProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Local state for collapsible model configuration section
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.liteLlmBaseUrl || ""}
				style={{ width: "100%" }}
				type="url"
				onInput={(e: any) => handleFieldChange("liteLlmBaseUrl", e.target.value)}
				placeholder={"Default: http://localhost:4000"}>
				<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.liteLlmApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={(e: any) => handleFieldChange("liteLlmApiKey", e.target.value)}
				placeholder="Default: noop">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.liteLlmModelId || ""}
				style={{ width: "100%" }}
				onInput={(e: any) => handleFieldChange("liteLlmModelId", e.target.value)}
				placeholder={"e.g. anthropic/claude-sonnet-4-20250514"}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>

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

			<>
				<ThinkingBudgetSlider />
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
			</>

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
						checked={!!apiConfiguration?.liteLlmModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = apiConfiguration?.liteLlmModelInfo
								? apiConfiguration.liteLlmModelInfo
								: { ...liteLlmModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked

							handleFieldChange("liteLlmModelInfo", modelInfo)
						}}>
						Supports Images
					</VSCodeCheckbox>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.liteLlmModelInfo?.contextWindow
									? apiConfiguration.liteLlmModelInfo.contextWindow.toString()
									: liteLlmModelInfoSaneDefaults.contextWindow?.toString()
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.liteLlmModelInfo
									? apiConfiguration.liteLlmModelInfo
									: { ...liteLlmModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(input.target.value)

								handleFieldChange("liteLlmModelInfo", modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</VSCodeTextField>
						<VSCodeTextField
							value={
								apiConfiguration?.liteLlmModelInfo?.maxTokens
									? apiConfiguration.liteLlmModelInfo.maxTokens.toString()
									: liteLlmModelInfoSaneDefaults.maxTokens?.toString()
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.liteLlmModelInfo
									? apiConfiguration.liteLlmModelInfo
									: { ...liteLlmModelInfoSaneDefaults }
								modelInfo.maxTokens = input.target.value

								handleFieldChange("liteLlmModelInfo", modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</VSCodeTextField>
					</div>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.liteLlmModelInfo?.temperature !== undefined
									? apiConfiguration.liteLlmModelInfo.temperature.toString()
									: liteLlmModelInfoSaneDefaults.temperature?.toString()
							}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.liteLlmModelInfo
									? apiConfiguration.liteLlmModelInfo
									: { ...liteLlmModelInfoSaneDefaults }

								// Check if the input ends with a decimal point or has trailing zeros after decimal
								const value = input.target.value
								const shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

								modelInfo.temperature =
									value === ""
										? liteLlmModelInfoSaneDefaults.temperature
										: shouldPreserveFormat
											? value // Keep as string to preserve decimal format
											: parseFloat(value)

								handleFieldChange("liteLlmModelInfo", modelInfo)
							}}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</VSCodeTextField>
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
				<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
			)}
		</div>
	)
}
