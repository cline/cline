import { geminiModels } from "@shared/api"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"

// Gemini models that support thinking/reasoning mode
const SUPPORTED_THINKING_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite-preview-06-17"]

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

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.geminiApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									geminiApiKey: value,
								},
							},
							updateMask: ["secrets.geminiApiKey"],
						}),
					)
				}}
				providerName="Gemini"
				signupUrl="https://aistudio.google.com/apikey"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.geminiBaseUrl}
				label="Use custom base URL"
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								options: {
									geminiBaseUrl: value,
								},
							},
							updateMask: ["options.geminiBaseUrl"],
						}),
					)
				}}
				placeholder="Default: https://generativelanguage.googleapis.com"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={geminiModels}
						onChange={async (e: any) => {
							const value = e.target.value

							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create(
									currentMode === "plan"
										? {
												updates: { options: { planModeApiModelId: value } },
												updateMask: ["options.planModeApiModelId"],
											}
										: {
												updates: { options: { actModeApiModelId: value } },
												updateMask: ["options.actModeApiModelId"],
											},
								),
							)
						}}
						selectedModelId={selectedModelId}
					/>

					{SUPPORTED_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
