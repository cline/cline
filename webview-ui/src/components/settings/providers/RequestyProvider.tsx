import { Mode } from "@shared/storage/types"
import { ApiKeyField } from "../common/ApiKeyField"
import RequestyModelPicker from "../RequestyModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the RequestyProvider component
 */
interface RequestyProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Requesty provider configuration component
 */
export const RequestyProvider = ({ showModelOptions, isPopup, currentMode }: RequestyProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.requestyApiKey || ""}
				onChange={(value) => handleFieldChange("requestyApiKey", value)}
				providerName="Requesty"
				signupUrl="https://app.requesty.ai/manage-api"
			/>

			{showModelOptions && <RequestyModelPicker isPopup={isPopup} currentMode={currentMode} />}
		</div>
	)
}
