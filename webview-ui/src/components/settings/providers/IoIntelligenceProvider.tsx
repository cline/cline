import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import IoIntelligenceModelPicker from "../IoIntelligenceModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the IoIntelligenceProvider component
 */
interface IoIntelligenceProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The IO Intelligence provider configuration component
 */
export const IoIntelligenceProvider = ({ showModelOptions, isPopup, currentMode }: IoIntelligenceProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.ioIntelligenceApiKey || ""}
				onChange={(value) => handleFieldChange("ioIntelligenceApiKey", value)}
				providerName="IO Intelligence"
				signupUrl="https://io.net/intelligence"
			/>

			{showModelOptions && <IoIntelligenceModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
