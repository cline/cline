import { databricksModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Databricks models that support thinking/reasoning mode (all Anthropic-based models support it)
export const SUPPORTED_DATABRICKS_THINKING_MODELS = [
	"databricks-claude-sonnet-4-5",
	"databricks-claude-sonnet-4",
	"databricks-claude-opus-4",
	"databricks-claude-opus-4-1",
	"databricks-claude-3-7-sonnet",
	"databricks-claude-3-5-sonnet",
]

/**
 * Props for the DatabricksProvider component
 */
interface DatabricksProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Databricks provider configuration component
 */
export const DatabricksProvider = ({ showModelOptions, isPopup, currentMode }: DatabricksProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<BaseUrlField
				alwaysVisible={true}
				initialValue={apiConfiguration?.databricksBaseUrl}
				label="Databricks Base URL"
				onChange={(value) => handleFieldChange("databricksBaseUrl", value)}
				placeholder="https://your-workspace.cloud.databricks.com/serving-endpoints"
			/>

			<ApiKeyField
				initialValue={apiConfiguration?.databricksApiKey || ""}
				onChange={(value) => handleFieldChange("databricksApiKey", value)}
				providerName="Databricks"
				signupUrl="https://docs.databricks.com/en/dev-tools/auth/index.html"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={databricksModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{SUPPORTED_DATABRICKS_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
