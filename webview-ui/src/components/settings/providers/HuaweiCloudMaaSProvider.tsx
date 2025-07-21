import { huaweiCloudMaaSModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Huawei Cloud MAAS models that support thinking/reasoning mode
const SUPPORTED_THINKING_MODELS = ["DeepSeek-R1", "deepseek-r1-250528"]

/**
 * Props for the HuaweiCloudMaaSProvider component
 */
interface HuaweiCloudMaaSProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Huawei Cloud MaaS provider configuration component
 */
export const HuaweiCloudMaaSProvider = ({ showModelOptions, isPopup }: HuaweiCloudMaaSProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.huaweiCloudMaaSApiKey || ""}
				onChange={(value) => handleFieldChange("huaweiCloudMaaSApiKey", value)}
				providerName="Huawei Cloud MAAS"
				signupUrl="https://console.huaweicloud.com/console/?region=cn-southwest-2#/home"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						models={huaweiCloudMaaSModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) => handleFieldChange("apiModelId", e.target.value)}
						label="Model"
					/>

					{SUPPORTED_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
