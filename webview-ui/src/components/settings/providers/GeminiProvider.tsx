import { openAiModelInfoSafeDefaults } from "@shared/api"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

/**
 * Props for the GeminiProvider component
 */
interface GeminiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Gemini provider configuration component
 */
export const GeminiProvider = ({ showModelOptions, isPopup, currentMode }: GeminiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels("gemini")
	const { config, commitSelection } = useProviderConfig("gemini")
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const fallbackModelId = defaultModelId || Object.keys(models)[0] || ""
	const selectedModel: ModelPickerSelection =
		committedSelection?.modelInfo !== undefined
			? {
					providerId: "gemini",
					modelId: committedSelection.modelId,
					modelInfo: fromProtobufModelInfo(committedSelection.modelInfo),
				}
			: {
					providerId: "gemini",
					modelId: fallbackModelId,
					modelInfo: models[fallbackModelId] ?? openAiModelInfoSafeDefaults,
				}

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitSelection(currentMode, selection).catch((err) =>
			console.error("Failed to commit Gemini model selection:", err),
		)
	}

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.geminiApiKey || ""}
				onChange={(value) => handleFieldChange("geminiApiKey", value)}
				providerName="Gemini"
				signupUrl="https://aistudio.google.com/apikey"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.geminiBaseUrl}
				label="Use custom base URL"
				onChange={(value) => handleFieldChange("geminiBaseUrl", value)}
				placeholder="Default: https://generativelanguage.googleapis.com"
			/>

			{showModelOptions && (
				<>
					<ModelPickerWithManualEntry
						allowsCustomIds={false}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={models}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}
