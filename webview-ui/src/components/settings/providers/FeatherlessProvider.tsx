import { DebouncedTextField } from "../common/DebouncedTextField"
import { ApiKeyField } from "../common/ApiKeyField"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { Mode } from "@shared/storage/types"

/**
 * Props for the FeatherlessProvider component
 */
interface FeatherlessProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Featherless provider configuration component
 */
export const FeatherlessProvider = ({ showModelOptions, isPopup, currentMode }: FeatherlessProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { apiModelId } = getModeSpecificFields(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.featherlessApiKey || ""}
				onChange={(value) => handleFieldChange("featherlessApiKey", value)}
				providerName="Featherless"
				signupUrl="https://featherless.ai/register"
			/>

			{showModelOptions && (
				<DebouncedTextField
					initialValue={apiModelId || ""}
					onChange={(value) =>
						handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, value, currentMode)
					}
					style={{ width: "100%", marginBottom: 10 }}
					placeholder={"e.g. moonshotai/Kimi-K2-Instruct"}>
					<span style={{ fontWeight: 500 }}>Model ID</span>
				</DebouncedTextField>
			)}
		</div>
	)
}
