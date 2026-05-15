import { Mode } from "@shared/storage/types"
import { GenericProviderSettings } from "./GenericProviderSettings"
import { getFallbackGenericProviderSettings } from "./providerSettingsRegistry"

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
			{...getFallbackGenericProviderSettings("deepseek")}
			currentMode={currentMode}
			isPopup={isPopup}
			showModelOptions={showModelOptions}
		/>
	)
}
