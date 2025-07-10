import { ApiConfiguration, stepFunModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the StepfunProvider component
 */
interface StepfunProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Stepfun provider configuration component
 */
export const StepfunProvider = ({ showModelOptions, isPopup }: StepfunProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	console.log("stepfun", selectedModelId, selectedModelInfo)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.stepFunApiKey || ""}
				onChange={(value) => handleFieldChange("stepFunApiKey", value)}
				providerName="StepFun"
				signupUrl="https://platform.stepfun.com/account-overview"
			/>
			{showModelOptions && (
				<>
					<ModelSelector
						models={stepFunModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) => handleFieldChange("apiModelId", e.target.value)}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
