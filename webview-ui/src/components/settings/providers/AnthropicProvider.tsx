import { anthropicModels, CLAUDE_SONNET_4_1M_SUFFIX } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"

// Anthropic models that support thinking/reasoning mode
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = [
	"claude-3-7-sonnet-20250219",
	"claude-sonnet-4-20250514",
	`claude-sonnet-4-20250514${CLAUDE_SONNET_4_1M_SUFFIX}`,
	"claude-opus-4-20250514",
	"claude-opus-4-1-20250805",
]

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Anthropic provider configuration component
 */
export const AnthropicProvider = ({ showModelOptions, isPopup, currentMode }: AnthropicProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Check if the current model is Claude Sonnet 4 and determine the alternate variant
	const claudeSonnet4Variant = useMemo(() => {
		const SONNET_4_MODEL_ID = "claude-sonnet-4-20250514"
		if (selectedModelId === SONNET_4_MODEL_ID) {
			return {
				current: SONNET_4_MODEL_ID,
				alternate: `${SONNET_4_MODEL_ID}${CLAUDE_SONNET_4_1M_SUFFIX}`,
				linkText: "Switch to 1M context window model",
			}
		} else if (selectedModelId === `${SONNET_4_MODEL_ID}${CLAUDE_SONNET_4_1M_SUFFIX}`) {
			return {
				current: `${SONNET_4_MODEL_ID}${CLAUDE_SONNET_4_1M_SUFFIX}`,
				alternate: SONNET_4_MODEL_ID,
				linkText: "Switch to 200K context window model",
			}
		}
		return null
	}, [selectedModelId])

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.apiKey || ""}
				onChange={(value) => handleFieldChange("apiKey", value)}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.anthropicBaseUrl}
				onChange={(value) => handleFieldChange("anthropicBaseUrl", value)}
				placeholder="Default: https://api.anthropic.com"
				label="Use custom base URL"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={anthropicModels}
						selectedModelId={selectedModelId}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						label="Model"
					/>

					{claudeSonnet4Variant && (
						<div style={{ marginBottom: 2 }}>
							<VSCodeLink
								style={{
									display: "inline",
									fontSize: "10.5px",
									color: "var(--vscode-textLink-foreground)",
								}}
								onClick={() =>
									handleModeFieldChange(
										{ plan: "planModeApiModelId", act: "actModeApiModelId" },
										claudeSonnet4Variant.alternate,
										currentMode,
									)
								}>
								{claudeSonnet4Variant.linkText}
							</VSCodeLink>
						</div>
					)}

					{SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} currentMode={currentMode} />
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
