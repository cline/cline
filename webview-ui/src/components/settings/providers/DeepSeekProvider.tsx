import { Mode } from "@shared/storage/types"
import { GenericProviderSettings } from "./GenericProviderSettings"
import { GENERIC_PROVIDER_SETTINGS } from "./providerSettingsRegistry"

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The DeepSeek provider configuration component
 */
export const DeepSeekProvider = ({ showModelOptions, isPopup, currentMode }: DeepSeekProviderProps) => {
	return (
		<GenericProviderSettings
			{...GENERIC_PROVIDER_SETTINGS.deepseek}
			currentMode={currentMode}
			isPopup={isPopup}
			showModelOptions={showModelOptions}
		/>
	)
}
