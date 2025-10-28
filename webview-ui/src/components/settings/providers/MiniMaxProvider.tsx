import { minimaxModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the MinimaxProvider component
 */
interface MinimaxProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Minimax AI Studio provider configuration component
 */
export const MinimaxProvider = ({ showModelOptions, isPopup, currentMode }: MinimaxProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="minimax-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>MiniMax Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="minimax-entrypoint"
					onChange={(e) => handleFieldChange("minimaxApiLine", (e.target as any).value)}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={apiConfiguration?.minimaxApiLine || "international"}>
					<VSCodeOption value="international">api.minimax.io</VSCodeOption>
					<VSCodeOption value="china">api.minimaxi.com</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Select the API endpoint according to your region: <code>api.minimaxi.com</code> for China, or{" "}
				<code>api.minimax.io</code> for all other locations.
			</p>
			<ApiKeyField
				initialValue={apiConfiguration?.minimaxApiKey || ""}
				onChange={(value) => handleFieldChange("minimaxApiKey", value)}
				providerName="MiniMax"
				signupUrl={
					apiConfiguration?.minimaxApiLine === "china"
						? "https://platform.minimaxi.com/user-center/basic-information/interface-key"
						: "https://www.minimax.io/platform/user-center/basic-information/interface-key"
				}
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={minimaxModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
