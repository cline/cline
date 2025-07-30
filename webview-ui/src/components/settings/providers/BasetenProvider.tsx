import { Mode } from "@shared/storage/types"
import { ApiKeyField } from "../common/ApiKeyField"
import BasetenModelPicker from "../BasetenModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the BasetenProvider component
 */
interface BasetenProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Baseten provider configuration component
 */
export const BasetenProvider = ({ showModelOptions, isPopup, currentMode }: BasetenProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.basetenApiKey || ""}
				onChange={(value) => handleFieldChange("basetenApiKey", value)}
				providerName="Baseten"
				signupUrl="https://app.baseten.co/settings/api_keys"
			/>

			{showModelOptions && <BasetenModelPicker isPopup={isPopup} currentMode={currentMode} />}
		</div>
	)
}
