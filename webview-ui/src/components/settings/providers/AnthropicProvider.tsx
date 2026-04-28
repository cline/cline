import {
	ANTHROPIC_FAST_MODE_SUFFIX,
	anthropicDefaultModelId,
	anthropicModelInfoSaneDefaults,
	anthropicModels,
	CLAUDE_SONNET_1M_SUFFIX,
} from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import styled from "styled-components"
import { Label } from "@/components/ui/label"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ContextWindowSwitcher } from "../common/ContextWindowSwitcher"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Anthropic models that support thinking/reasoning mode
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = [
	"claude-sonnet-4-6",
	`claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-3-7-sonnet-20250219",
	"claude-sonnet-4-20250514",
	`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-opus-4-20250514",
	"claude-opus-4-1-20250805",
	"claude-sonnet-4-5-20250929",
	`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-haiku-4-5-20251001",
]

const StyledCheckbox = styled(VSCodeCheckbox)`
	margin-bottom: 4px;
`

const isCustomModel = (modelId: string | undefined) => {
	return modelId && !(modelId in anthropicModels)
}

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
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { handleFieldChange, handleFieldsChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)

	const [useCustomModel, setUseCustomModel] = useState(!!modeFields.anthropicModelInfo)

	useEffect(() => {
		setUseCustomModel(!!modeFields.anthropicModelInfo)
	}, [currentMode])

	// Get the normalized configuration
	const baseSelection = normalizeApiConfiguration(apiConfiguration, currentMode)
	const selectedModelId = baseSelection.selectedModelId
	const selectedModelInfo = useCustomModel
		? baseSelection.selectedModelInfo
		: modeFields.apiModelId && modeFields.apiModelId in anthropicModels
			? anthropicModels[modeFields.apiModelId as keyof typeof anthropicModels]
			: anthropicModels[anthropicDefaultModelId]
	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(selectedModelId)
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none"

	// Helper function for model switching
	const handleModelChange = (modelId: string) => {
		handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, modelId, currentMode)
	}

	const handleCustomModelInfoChange = (field: string, value: string | number | boolean) => {
		const currentInfo = modeFields.anthropicModelInfo || { ...anthropicModelInfoSaneDefaults }
		const updatedInfo = { ...currentInfo, [field]: value }

		handleFieldsChange({
			planModeApiModelId: currentMode === "plan" ? modeFields.apiModelId : apiConfiguration?.planModeApiModelId,
			actModeApiModelId: currentMode === "act" ? modeFields.apiModelId : apiConfiguration?.actModeApiModelId,
			planModeAnthropicModelInfo: currentMode === "plan" ? updatedInfo : apiConfiguration?.planModeAnthropicModelInfo,
			actModeAnthropicModelInfo: currentMode === "act" ? updatedInfo : apiConfiguration?.actModeAnthropicModelInfo,
		} as any)
	}

	const handleToggleCustomModel = (checked: boolean) => {
		setUseCustomModel(checked)
		const modeModelIdKey = currentMode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
		const modeModelInfoKey = currentMode === "plan" ? "planModeAnthropicModelInfo" : "actModeAnthropicModelInfo"
		if (checked) {
			// Initialize with sane defaults, keeping current model ID if set
			handleFieldsChange({
				[modeModelIdKey]: modeFields.apiModelId || "custom-model",
				[modeModelInfoKey]: modeFields.anthropicModelInfo || { ...anthropicModelInfoSaneDefaults },
			} as any)
		} else {
			// Clear custom model info for CURRENT mode only, switch to first predefined model
			handleFieldsChange({
				[modeModelInfoKey]: undefined,
				[modeModelIdKey]: Object.keys(anthropicModels)[0],
			} as any)
		}
	}

	const customModelInfo = modeFields.anthropicModelInfo || anthropicModelInfoSaneDefaults

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.apiKey || ""}
				onChange={(value) => handleFieldChange("apiKey", value)}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.anthropicBaseUrl === undefined}>
				<BaseUrlField
					disabled={!!remoteConfigSettings?.anthropicBaseUrl}
					initialValue={apiConfiguration?.anthropicBaseUrl}
					label="Use custom base URL"
					onChange={(value) => handleFieldChange("anthropicBaseUrl", value)}
					placeholder="Default: https://api.anthropic.com"
					showLockIcon={!!remoteConfigSettings?.anthropicBaseUrl}
				/>
			</RemotelyConfiguredInputWrapper>

			{showModelOptions && (
				<>
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
						<StyledCheckbox
							checked={useCustomModel}
							onChange={(e: any) => handleToggleCustomModel(e.target.checked === true)}>
							Use custom model ID
						</StyledCheckbox>
					</div>

					{useCustomModel ? (
						<CustomModelConfig
							modelId={modeFields.apiModelId || ""}
							modelInfo={customModelInfo}
							onModelIdChange={handleModelChange}
							onModelInfoChange={handleCustomModelInfoChange}
						/>
					) : (
						<>
							<ModelSelector
								label="Model"
								models={anthropicModels}
								onChange={(e) =>
									handleModeFieldChange(
										{ plan: "planModeApiModelId", act: "actModeApiModelId" },
										e.target.value,
										currentMode,
									)
								}
								selectedModelId={selectedModelId}
							/>

							{/* Context window switcher for Claude Opus 4.6 */}
							<ContextWindowSwitcher
								base1mModelId={`claude-opus-4-6${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-opus-4-6"
								onModelChange={handleModelChange}
								selectedModelId={selectedModelId}
							/>

							<ContextWindowSwitcher
								base1mModelId={`claude-opus-4-6${CLAUDE_SONNET_1M_SUFFIX}${ANTHROPIC_FAST_MODE_SUFFIX}`}
								base200kModelId={`claude-opus-4-6${ANTHROPIC_FAST_MODE_SUFFIX}`}
								onModelChange={handleModelChange}
								selectedModelId={selectedModelId}
							/>

							{/* Context window switcher for Claude Sonnet 4.6 */}
							<ContextWindowSwitcher
								base1mModelId={`claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-sonnet-4-6"
								onModelChange={handleModelChange}
								selectedModelId={selectedModelId}
							/>

							{/* Context window switcher for Claude Sonnet 4.5 */}
							<ContextWindowSwitcher
								base1mModelId={`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-sonnet-4-5-20250929"
								onModelChange={handleModelChange}
								selectedModelId={selectedModelId}
							/>

							{/* Context window switcher for Claude Sonnet 4 */}
							<ContextWindowSwitcher
								base1mModelId={`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-sonnet-4-20250514"
								onModelChange={handleModelChange}
								selectedModelId={selectedModelId}
							/>
						</>
					)}

					{useCustomModel ? (
						<>
							{customModelInfo.supportsReasoning && (
								<ThinkingBudgetSlider
									currentMode={currentMode}
									maxBudget={customModelInfo.thinkingConfig?.maxBudget}
								/>
							)}
							{customModelInfo.supportsReasoning && (modeFields.thinkingBudgetTokens || 0) > 0 && (
								<ReasoningEffortSelector
									allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
									currentMode={currentMode}
									defaultEffort={adaptiveThinkingDefaultEffort}
									description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
									label="Adaptive Thinking"
								/>
							)}
						</>
					) : isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							label="Adaptive Thinking"
						/>
					) : SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId) ? (
						<ThinkingBudgetSlider
							currentMode={currentMode}
							maxBudget={(selectedModelInfo as any).thinkingConfig?.maxBudget}
						/>
					) : null}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

interface CustomModelConfigProps {
	modelId: string
	modelInfo: typeof anthropicModelInfoSaneDefaults
	onModelIdChange: (id: string) => void
	onModelInfoChange: (field: string, value: string | number | boolean) => void
}

const CustomModelConfig = ({ modelId, modelInfo, onModelIdChange, onModelInfoChange }: CustomModelConfigProps) => {
	return (
		<div style={{ marginBottom: 8 }}>
			<DebouncedTextField
				initialValue={modelId || ""}
				onChange={(value) => onModelIdChange(value)}
				placeholder="deepseek-v4-pro"
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={String(modelInfo.maxTokens || 0)}
					onChange={(value) => onModelInfoChange("maxTokens", Number(value) || 0)}
					placeholder={`${anthropicModelInfoSaneDefaults.maxTokens ?? 128000}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Max Tokens</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={String(modelInfo.contextWindow || 0)}
					onChange={(value) => onModelInfoChange("contextWindow", Number(value) || 0)}
					placeholder={`${anthropicModelInfoSaneDefaults.contextWindow ?? 1000000}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Context Window</span>
				</DebouncedTextField>
			</div>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={String(modelInfo.inputPrice ?? 0)}
					onChange={(value) => onModelInfoChange("inputPrice", Number(value) || 0)}
					placeholder={`${anthropicModelInfoSaneDefaults.inputPrice ?? 1}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Input Price ($/M)</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={String(modelInfo.outputPrice ?? 0)}
					onChange={(value) => onModelInfoChange("outputPrice", Number(value) || 0)}
					placeholder={`${anthropicModelInfoSaneDefaults.outputPrice ?? 2}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Output Price ($/M)</span>
				</DebouncedTextField>
			</div>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={String(modelInfo.cacheWritesPrice ?? 0)}
					onChange={(value) => onModelInfoChange("cacheWritesPrice", Number(value) || 0)}
					placeholder={`${anthropicModelInfoSaneDefaults.cacheWritesPrice ?? 0}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Cache Writes ($/M)</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={String(modelInfo.cacheReadsPrice ?? 0)}
					onChange={(value) => onModelInfoChange("cacheReadsPrice", Number(value) || 0)}
					placeholder={`${anthropicModelInfoSaneDefaults.cacheReadsPrice ?? 0}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Cache Reads ($/M)</span>
				</DebouncedTextField>
			</div>

			<div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
				<Label className="text-xs font-medium">Options</Label>
				<VSCodeCheckbox
					checked={modelInfo.supportsImages ?? false}
					onChange={(e: any) => onModelInfoChange("supportsImages", e.target.checked === true)}>
					Supports Images
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={modelInfo.supportsPromptCache ?? true}
					onChange={(e: any) => onModelInfoChange("supportsPromptCache", e.target.checked === true)}>
					Supports Prompt Cache
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={modelInfo.supportsReasoning ?? true}
					onChange={(e: any) => onModelInfoChange("supportsReasoning", e.target.checked === true)}>
					Supports Reasoning
				</VSCodeCheckbox>
			</div>
		</div>
	)
}
