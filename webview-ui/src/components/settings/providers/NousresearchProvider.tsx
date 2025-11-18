import { nousResearchModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the NousResearchProvider component
 */
interface NousResearchProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The NousResearch provider configuration component
 */
export const NousResearchProvider = ({ showModelOptions, isPopup, currentMode }: NousResearchProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.nousResearchApiKey || ""}
				onChange={(value) => handleFieldChange("nousResearchApiKey", value)}
				providerName="NousResearch"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={nousResearchModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeNousResearchModelId", act: "actModeNousResearchModelId" },
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
