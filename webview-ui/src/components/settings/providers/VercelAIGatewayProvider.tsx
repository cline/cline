import { ApiKeyField } from "../common/ApiKeyField"
import VercelAIGatewayModelPicker from "../VercelAIGatewayModelPicker"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { Mode } from "@shared/storage/types"

/**
 * Props for the VercelAIGatewayProvider component
 */
interface VercelAIGatewayProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Vercel AI Gateway provider configuration component
 */
export const VercelAIGatewayProvider = ({ showModelOptions, isPopup, currentMode }: VercelAIGatewayProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.vercelAiGatewayApiKey || ""}
				onChange={(value) => handleFieldChange("vercelAiGatewayApiKey", value)}
				providerName="Vercel AI Gateway"
				signupUrl="https://vercel.com/"
			/>

			{showModelOptions && <VercelAIGatewayModelPicker isPopup={isPopup} currentMode={currentMode} />}
		</div>
	)
}
