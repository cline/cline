import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import TarsModelPicker from "../TarsModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Props for the TarsProvider component.
interface TarsProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

// The Tetrate Agent Router Service (TARS) provider configuration component.
export const TarsProvider = ({ showModelOptions, isPopup, currentMode }: TarsProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.tarsApiKey || ""}
				onChange={(value) => handleFieldChange("tarsApiKey", value)}
				providerName="TARS"
				signupUrl="https://router.tetrate.ai"
			/>
			{showModelOptions && <TarsModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
