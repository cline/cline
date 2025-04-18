import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import {
	ApiConfiguration,
	ModelInfo,
	anthropicModels,
	bedrockModels,
	vertexModels,
	geminiModels,
	openAiNativeModels,
	deepSeekModels,
	mainlandQwenModels,
	internationalQwenModels,
	doubaoModels,
	mistralModels,
	askSageModels,
	xaiModels,
	sambanovaModels,
} from "@shared/api"
import { useExtensionState } from "@/context/ExtensionStateContext"
import DropdownContainer from "../DropdownContainer"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import ModelInfoView from "./ModelInfoView"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"

const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX - 1

interface ModelPickerProps {
	selectedProvider: string
	selectedModelId: string
	selectedModelInfo: any
	isPopup?: boolean
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
}

const ModelPicker = ({ selectedProvider, selectedModelId, selectedModelInfo, isPopup, handleInputChange }: ModelPickerProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!apiConfiguration?.reasoningEffort)

	const createModelDropdown = () => {
		let models: Record<string, ModelInfo> = {}

		switch (selectedProvider) {
			case "anthropic":
				models = anthropicModels
				break
			case "bedrock":
				models = bedrockModels
				break
			case "vertex":
				models = vertexModels
				break
			case "gemini":
				models = geminiModels
				break
			case "openai-native":
				models = openAiNativeModels
				break
			case "deepseek":
				models = deepSeekModels
				break
			case "qwen":
				models = apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels
				break
			case "doubao":
				models = doubaoModels
				break
			case "mistral":
				models = mistralModels
				break
			case "asksage":
				models = askSageModels
				break
			case "xai":
				models = xaiModels
				break
			case "sambanova":
				models = sambanovaModels
				break
			default:
				return null
		}

		return (
			<VSCodeDropdown
				id="model-id"
				value={selectedModelId}
				onChange={handleInputChange("apiModelId")}
				style={{ width: "100%" }}>
				<VSCodeOption value="">Select a model...</VSCodeOption>
				{Object.keys(models).map((modelId) => (
					<VSCodeOption
						key={modelId}
						value={modelId}
						style={{
							whiteSpace: "normal",
							wordWrap: "break-word",
							maxWidth: "100%",
						}}>
						{modelId}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		)
	}

	const showThinkingBudgetSlider =
		(selectedProvider === "anthropic" && selectedModelId === "claude-3-7-sonnet-20250219") ||
		(selectedProvider === "bedrock" && selectedModelId === "anthropic.claude-3-7-sonnet-20250219-v1:0") ||
		(selectedProvider === "vertex" && selectedModelId === "claude-3-7-sonnet@20250219")

	const showReasoningEffort = selectedProvider === "xai" && selectedModelId.includes("3-mini")

	return (
		<>
			<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
				<label htmlFor="model-id">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>
				{createModelDropdown()}
			</DropdownContainer>

			{showThinkingBudgetSlider && (
				<ThinkingBudgetSlider apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
			)}

			{showReasoningEffort && (
				<>
					<VSCodeCheckbox
						style={{ marginTop: 0 }}
						checked={reasoningEffortSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setReasoningEffortSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									...apiConfiguration,
									reasoningEffort: "",
								})
							}
						}}>
						Modify reasoning effort
					</VSCodeCheckbox>

					{reasoningEffortSelected && (
						<div>
							<label htmlFor="reasoning-effort-dropdown">
								<span style={{}}>Reasoning Effort</span>
							</label>
							<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 100}>
								<VSCodeDropdown
									id="reasoning-effort-dropdown"
									style={{ width: "100%", marginTop: 3 }}
									value={apiConfiguration?.reasoningEffort || "high"}
									onChange={(e: any) => {
										setApiConfiguration({
											...apiConfiguration,
											reasoningEffort: e.target.value,
										})
									}}>
									<VSCodeOption value="low">low</VSCodeOption>
									<VSCodeOption value="high">high</VSCodeOption>
								</VSCodeDropdown>
							</DropdownContainer>
							<p
								style={{
									fontSize: "12px",
									marginTop: 3,
									marginBottom: 0,
									color: "var(--vscode-descriptionForeground)",
								}}>
								High effort may produce more thorough analysis but takes longer and uses more tokens.
							</p>
						</div>
					)}
				</>
			)}

			<ModelInfoView
				selectedModelId={selectedModelId}
				modelInfo={selectedModelInfo}
				isDescriptionExpanded={isDescriptionExpanded}
				setIsDescriptionExpanded={setIsDescriptionExpanded}
				isPopup={isPopup}
			/>
		</>
	)
}

export default memo(ModelPicker)
