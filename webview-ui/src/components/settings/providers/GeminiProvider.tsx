import { Mode } from "@shared/storage/types"
import { GenericProviderSettings } from "./GenericProviderSettings"
import { GENERIC_PROVIDER_SETTINGS } from "./providerSettingsRegistry"

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
			{...GENERIC_PROVIDER_SETTINGS.gemini}
			currentMode={currentMode}
			isPopup={isPopup}
			showModelOptions={showModelOptions}
		/>
	)
}
