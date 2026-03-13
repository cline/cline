import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the CoreweaveProvider component
 */
interface CoreweaveProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The CoreWeave (W&B Inference) provider configuration component
 */
export const CoreweaveProvider = ({ showModelOptions, isPopup, currentMode }: CoreweaveProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { coreweaveModelId } = getModeSpecificFields(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.coreweaveApiKey || ""}
				onChange={(value) => handleFieldChange("coreweaveApiKey", value)}
				providerName="CoreWeave (W&B Inference)"
			/>
			<DebouncedTextField
				initialValue={coreweaveModelId || ""}
				onChange={(value) =>
					handleModeFieldChange(
						{ plan: "planModeCoreweaveModelId", act: "actModeCoreweaveModelId" },
						value,
						currentMode,
					)
				}
				placeholder={"Enter Model ID (e.g., moonshotai/Kimi-K2.5)..."}
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
