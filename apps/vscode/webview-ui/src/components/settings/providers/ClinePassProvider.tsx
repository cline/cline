import type { ModelInfo } from "@shared/api"
import { openAiModelInfoSafeDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

interface ClinePassProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const CLINE_PASS_PROVIDER_ID = "cline-pass"

function clinePassFallbackModelInfo(modelId: string): ModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
	}
}

/**
 * ClinePass is a first-class SDK provider whose credentials are backed by the
 * user's Cline OAuth account. Keep the UX close to the Cline provider (account
 * card + model selection), but resolve and persist selections through the SDK
 * provider catalog under providerId="cline-pass".
 */
export const ClinePassProvider = ({ showModelOptions, isPopup, currentMode }: ClinePassProviderProps) => {
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels(CLINE_PASS_PROVIDER_ID)
	const { config, write, commitSelection } = useProviderConfig(CLINE_PASS_PROVIDER_ID)
	const { selectedModel, commitModelSelection } = useProviderModelSelection(CLINE_PASS_PROVIDER_ID, currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
		customModelInfo: clinePassFallbackModelInfo,
	})

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitModelSelection(selection).catch((err) => console.error("Failed to commit ClinePass model selection:", err))
	}

	return (
		<div>
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ClineAccountInfoCard />
			</div>

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

					{selectedModel.modelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							onEffortChange={(effort) => {
								void write({
									reasoning: {
										enabled: effort !== "none",
										effort: effort !== "none" ? effort : undefined,
									},
								}).catch((err) => console.error("Failed to update ClinePass reasoning effort:", err))
							}}
						/>
					)}

					<ModelInfoView
						hideUsageCost={true}
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}
