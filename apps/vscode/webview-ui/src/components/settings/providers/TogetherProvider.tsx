import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the TogetherProvider component
 */
interface TogetherProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Together provider configuration component
 */
export const TogetherProvider = ({ showModelOptions, isPopup, currentMode }: TogetherProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { togetherModelId } = getModeSpecificFields(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.togetherApiKey || ""}
				onChange={(value) => handleFieldChange("togetherApiKey", value)}
				providerName="Together"
			/>
			<DebouncedTextField
				initialValue={togetherModelId || ""}
				onChange={(value) =>
					handleModeFieldChange({ plan: "planModeTogetherModelId", act: "actModeTogetherModelId" }, value, currentMode)
				}
				placeholder={"Enter Model ID..."}
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>
		</div>
	)
}
