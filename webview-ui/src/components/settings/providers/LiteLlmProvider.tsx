import { liteLlmModelInfoSaneDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
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
			<DebouncedTextField
				initialValue={liteLlmModelId || ""}
				onChange={(value) =>
					handleModeFieldChange({ plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" }, value, currentMode)
				}
				placeholder={"e.g. anthropic/claude-sonnet-4-20250514"}
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

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

								// Check if the input ends with a decimal point or has trailing zeros after decimal
								const _shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

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
