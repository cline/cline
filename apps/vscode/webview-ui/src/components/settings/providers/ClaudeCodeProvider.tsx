import { openAiModelInfoSafeDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

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
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const providerId = "claude-code"
	const { models, defaultModelId } = useProviderModels(providerId)
	// The models reuse Anthropic API pricing metadata, but usage is billed
	// through the Claude subscription — suppress the per-token price rows.
	const hideUsageCost = useProviderUsageCostDisplay(providerId) !== "show"
	const { config, write, commitSelection } = useProviderConfig(providerId)
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
				placeholder={t("providers:shared.defaultPlaceholder", { value: "claude" })}
				style={{ width: "100%", marginTop: 3 }}
				type="text">
				<span style={{ fontWeight: 500 }}>{t("providers:claudeCode.cliPathLabel")}</span>
			</DebouncedTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("providers:claudeCode.cliPathDescription")}
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						label={t("providers:shared.modelLabel")}
						models={models}
						onChange={handleModelSelect}
						selectedModelId={selectedModelId}
					/>

					{(selectedModelId === "sonnet" || selectedModelId === "opus") && (
						<p
							style={{
								fontSize: "12px",
								marginBottom: 2,
								marginTop: 2,
								color: "var(--vscode-descriptionForeground)",
							}}>
							{t("providers:claudeCode.latestVersionNote", { model: selectedModelId })}
						</p>
					)}

					{selectedModelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							defaultEffort="none"
							description={t("providers:shared.extendedThinkingDescription")}
							onEffortChange={(effort) => {
								void write({
									reasoning: { enabled: effort !== "none", effort: effort !== "none" ? effort : undefined },
								}).catch((err) => console.error("Failed to update Claude Code reasoning effort:", err))
							}}
						/>
					)}

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
