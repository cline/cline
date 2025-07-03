import { claudeCodeModels } from "@shared/api"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SUPPORTED_ANTHROPIC_THINKING_MODELS } from "./AnthropicProvider"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"

/**
 * Props for the ClaudeCodeProvider component
 */
interface ClaudeCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Claude Code provider configuration component
 */
export const ClaudeCodeProvider = ({ showModelOptions, isPopup }: ClaudeCodeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.claudeCodePath || ""}
				onChange={(value) => handleFieldChange("claudeCodePath", value)}
				style={{ width: "100%", marginTop: 3 }}
				type="text"
				placeholder="Default: claude">
				<span style={{ fontWeight: 500 }}>Claude Code CLI Path</span>
			</DebouncedTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Path to the Claude Code CLI.
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						models={claudeCodeModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) => handleFieldChange("apiModelId", e.target.value)}
						label="Model"
					/>

					{SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
