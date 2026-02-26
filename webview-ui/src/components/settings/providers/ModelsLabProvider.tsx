import { modelsLabModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the ModelsLabProvider component
 */
interface ModelsLabProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The ModelsLab provider configuration component.
 * ModelsLab (https://modelslab.com) provides an OpenAI-compatible chat endpoint
 * with uncensored Llama models.
 */
export const ModelsLabProvider = ({ showModelOptions, isPopup, currentMode }: ModelsLabProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.modelsLabApiKey || ""}
				onChange={(value) => handleFieldChange("modelsLabApiKey", value)}
				providerName="ModelsLab"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={modelsLabModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeModelsLabModelId", act: "actModeModelsLabModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
				</>
			)}
		</div>
	)
}
