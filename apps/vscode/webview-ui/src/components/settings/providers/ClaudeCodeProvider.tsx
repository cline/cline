import { openAiModelInfoSafeDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { SUPPORTED_ANTHROPIC_THINKING_MODELS } from "./AnthropicProvider"

const SUPPORTED_CLAUDE_CODE_THINKING_MODELS = [
	...SUPPORTED_ANTHROPIC_THINKING_MODELS,
	"sonnet",
	"sonnet[1m]",
	"claude-fable-5[1m]",
	"claude-opus-4-8[1m]",
	"claude-opus-4-7[1m]",
	"claude-sonnet-4-6[1m]",
	"claude-sonnet-4-5-20250929[1m]",
	"claude-opus-4-6[1m]",
	"opus",
	"opus[1m]",
]

/**
 * Props for the ClaudeCodeProvider component
 */
interface ClaudeCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Claude Code provider configuration component
 */
export const ClaudeCodeProvider = ({ showModelOptions, isPopup, currentMode }: ClaudeCodeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const providerId = "claude-code"
	const { models, defaultModelId } = useProviderModels(providerId)
	const { config, commitSelection } = useProviderConfig(providerId)
	const { selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection(providerId, currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
	})

	const handleModelSelect = (event: {
		target?: { value?: unknown }
		currentTarget?: { value?: unknown }
		detail?: { value?: unknown }
	}) => {
		const modelId = event.target?.value ?? event.currentTarget?.value ?? event.detail?.value
		if (typeof modelId !== "string" || modelId.length === 0) {
			return
		}
		void commitModelSelection({
			modelId,
			modelInfo: models[modelId] ?? selectedModelInfo ?? openAiModelInfoSafeDefaults,
		}).catch((err) => console.error("Failed to commit Claude Code model selection:", err))
	}

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.claudeCodePath || ""}
				onChange={(value) => handleFieldChange("claudeCodePath", value)}
				placeholder="Default: claude"
				style={{ width: "100%", marginTop: 3 }}
				type="text">
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
					<ModelSelector label="模型" models={models} onChange={handleModelSelect} selectedModelId={selectedModelId} />

					{(selectedModelId === "sonnet" || selectedModelId === "opus") && (
						<p
							style={{
								fontSize: "12px",
								marginBottom: 2,
								marginTop: 2,
								color: "var(--vscode-descriptionForeground)",
							}}>
							Use the latest version of {selectedModelId} by default.
						</p>
					)}

					{SUPPORTED_CLAUDE_CODE_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
