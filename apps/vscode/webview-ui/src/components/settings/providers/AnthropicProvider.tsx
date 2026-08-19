import { openAiModelInfoSafeDefaults } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

const PROVIDER_ID = "anthropic"

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
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const { config, write, commitSelection } = useProviderConfig(PROVIDER_ID)

	// Get the normalized configuration
	const {
		models,
		defaultModelId,
		selectedModelId: legacySelectedModelId,
		selectedModelInfo: legacySelectedModelInfo,
		hideUsageCost,
	} = useStaticProviderSelection(PROVIDER_ID, apiConfiguration, currentMode)
	const { selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection(PROVIDER_ID, currentMode, {
		models,
		defaultModelId: defaultModelId || legacySelectedModelId,
		config,
		commitSelection,
		fallbackModelInfo: legacySelectedModelInfo,
	})
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Anthropic",
		write,
	})
	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(selectedModelId)
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none"

	const handleBaseUrlChange = (value: string) => {
		void write({ baseUrl: value }).catch((err) => console.error("Failed to update Anthropic base URL:", err))
	}
	const handleBaseUrlClear = async () => {
		try {
			await write({ baseUrl: "" })
		} catch (error) {
			console.error("Failed to clear Anthropic base URL:", error)
			throw error
		}
	}

	const handleModelChange = (modelId: string) => {
		if (!modelId) {
			return
		}

		const fallbackModelId = defaultModelId || Object.keys(models)[0] || modelId
		const modelInfo = models[modelId] ?? models[fallbackModelId] ?? selectedModelInfo ?? openAiModelInfoSafeDefaults

		void commitModelSelection({ modelId, modelInfo }).catch((err) =>
			console.error("Failed to commit Anthropic model selection:", err),
		)
	}

	const handleReasoningEffortChange = (effort: string) => {
		void write({ reasoning: { enabled: effort !== "none", effort } }).catch((err) =>
			console.error("Failed to update Anthropic reasoning effort:", err),
		)
	}

	return (
		<div>
			<ApiKeyField
				initialValue={savedApiKeyMask}
				onChange={handleApiKeyChange}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.anthropicBaseUrl === undefined}>
				<BaseUrlField
					disabled={!!remoteConfigSettings?.anthropicBaseUrl}
					initialValue={config?.baseUrl}
					label="Use custom base URL"
					onChange={handleBaseUrlChange}
					onClear={handleBaseUrlClear}
					placeholder="Default: https://api.anthropic.com"
					showLockIcon={!!remoteConfigSettings?.anthropicBaseUrl}
				/>
			</RemotelyConfiguredInputWrapper>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(e) => handleModelChange(e.target.value)}
						selectedModelId={selectedModelId}
					/>

					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							label="Adaptive Thinking"
							onEffortChange={handleReasoningEffortChange}
						/>
					) : selectedModelInfo.supportsReasoning === true ? (
						<ReasoningEffortSelector
							currentMode={currentMode}
							defaultEffort="none"
							description="Use None to disable extended thinking. Higher effort improves depth, but uses more tokens."
							onEffortChange={handleReasoningEffortChange}
						/>
					) : null}

					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
