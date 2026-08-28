import { openAiModelInfoSafeDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

const PROVIDER_ID = "xai"

// VSCodeDropdown's onChange supplies `Event | React.FormEvent<HTMLElement>`,
// so accept the same union here. We only read `target.value`, which is present
// on both, so no narrowing of the event itself is required.
function getEventValue(event: Event | React.FormEvent<HTMLElement>): string {
	const target = event.target
	if (target && "value" in target && typeof target.value === "string") {
		return target.value
	}
	return ""
}

/**
 * Props for the XaiProvider component
 */
interface XaiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const XaiProvider = ({ showModelOptions, isPopup, currentMode }: XaiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
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
		defaultModelId: legacySelectedModelId,
		config,
		commitSelection,
		fallbackModelInfo: legacySelectedModelInfo,
	})

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "X AI",
		write,
	})

	const handleModelChange = (modelId: string) => {
		if (!modelId) {
			return
		}

		const fallbackModelId = defaultModelId || Object.keys(models)[0] || modelId
		const modelInfo = models[modelId] ?? models[fallbackModelId] ?? selectedModelInfo ?? openAiModelInfoSafeDefaults

		void commitModelSelection({
			modelId,
			modelInfo,
		}).catch((err) => console.error("Failed to commit X AI model selection:", err))
	}

	const handleReasoningEffortChange = (effort: string) => {
		void write({
			reasoning: { enabled: effort !== "none", effort: effort !== "none" ? effort : undefined },
		}).catch((err) => console.error("Failed to update X AI reasoning effort:", err))
	}

	return (
		<div>
			<div>
				<ApiKeyField
					initialValue={savedApiKeyMask || apiConfiguration?.xaiApiKey || ""}
					onChange={handleApiKeyChange}
					providerName="X AI"
					signupUrl="https://x.ai"
				/>
				<p
					style={{
						fontSize: "12px",
						marginTop: -10,
						color: "var(--vscode-descriptionForeground)",
					}}>
					<span style={{ color: "var(--vscode-errorForeground)" }}>
						(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts, so behavior can vary across
						models. Less capable models may not work as expected.)
					</span>
				</p>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(event: Event) => handleModelChange(getEventValue(event))}
						selectedModelId={selectedModelId}
					/>

					{selectedModelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector currentMode={currentMode} onEffortChange={handleReasoningEffortChange} />
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
