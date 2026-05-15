import { Mode } from "@shared/storage/types"
import { GenericProviderSettings } from "./GenericProviderSettings"
import { getFallbackGenericProviderSettings } from "./providerSettingsRegistry"

/**
 * Props for the GeminiProvider component
 */
interface GeminiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Gemini provider configuration component
 */
export const GeminiProvider = ({ showModelOptions, isPopup, currentMode }: GeminiProviderProps) => {
	return (
		<GenericProviderSettings
			{...getFallbackGenericProviderSettings("gemini")}
			currentMode={currentMode}
			isPopup={isPopup}
			showModelOptions={showModelOptions}
		/>
	)
}
