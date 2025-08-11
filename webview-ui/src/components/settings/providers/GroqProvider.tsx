import { Mode } from "@shared/storage/types"
import { ApiKeyField } from "../common/ApiKeyField"
import GroqModelPicker from "../GroqModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the GroqProvider component
 */
interface GroqProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Groq provider configuration component
 */
export const GroqProvider = ({ showModelOptions, isPopup, currentMode }: GroqProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.groqApiKey || ""}
				onChange={(value) => handleFieldChange("groqApiKey", value)}
				providerName="Groq"
				signupUrl="https://console.groq.com/keys"
			/>

			{showModelOptions && <GroqModelPicker isPopup={isPopup} currentMode={currentMode} />}
		</div>
	)
}
