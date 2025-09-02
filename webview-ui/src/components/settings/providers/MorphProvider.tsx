import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface MorphProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const MorphProvider = ({ showModelOptions, isPopup, currentMode }: MorphProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<DebouncedTextField
					initialValue={(apiConfiguration as any)?.morphApiUrl || ""}
					onChange={(value) => {
						handleFieldChange("morphApiUrl" as any, value as any)
					}}
					placeholder={"Enter base URL..."}
					style={{ width: "100%", marginBottom: 10 }}
					type="url">
					<span style={{ fontWeight: 500 }}>Base URL</span>
				</DebouncedTextField>

				<ApiKeyField
					initialValue={(apiConfiguration as any)?.morphApiKey || ""}
					onChange={(value) => {
						handleFieldChange("morphApiKey" as any, value as any)
					}}
					providerName="Morph"
				/>

				<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "5px" }}>
					<p>
						Morph Fast Apply uses a code-aware merge model to apply your instructions to existing files. Configure
						your Morph base URL and API key to enable the edit_file tool.
					</p>
				</div>
			</div>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
