import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface CopilotSdkProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const CopilotSdkProvider = ({ showModelOptions, isPopup, currentMode }: CopilotSdkProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const useLoggedInUser = apiConfiguration?.copilotUseLoggedInUser ?? true

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.copilotCliPath || ""}
				onChange={(value) => handleFieldChange("copilotCliPath", value)}
				placeholder="Default: copilot"
				style={{ width: "100%", marginBottom: 10 }}
				type="text">
				<span style={{ fontWeight: 500 }}>Copilot CLI Path</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 10,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Path to the GitHub Copilot CLI binary. Leave blank to use <code>copilot</code> from your PATH.
			</p>

			<DebouncedTextField
				initialValue={apiConfiguration?.copilotCliArgs || ""}
				onChange={(value) => handleFieldChange("copilotCliArgs", value)}
				placeholder="Optional CLI args..."
				style={{ width: "100%", marginBottom: 10 }}
				type="text">
				<span style={{ fontWeight: 500 }}>Copilot CLI Args</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 10,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Optional arguments passed to the Copilot CLI (e.g. <code>--log-level=info</code>).
			</p>

			<DebouncedTextField
				initialValue={apiConfiguration?.copilotCliUrl || ""}
				onChange={(value) => handleFieldChange("copilotCliUrl", value)}
				placeholder="Optional: localhost:8080"
				style={{ width: "100%", marginBottom: 10 }}
				type="text">
				<span style={{ fontWeight: 500 }}>Copilot CLI URL</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 10,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Connect to an existing Copilot CLI server. When set, CLI path and auth fields are ignored.
			</p>

			<ApiKeyField
				initialValue={apiConfiguration?.copilotGithubToken || ""}
				onChange={(value) => handleFieldChange("copilotGithubToken", value)}
				providerName="GitHub Copilot"
				placeholder="Optional GitHub token..."
				helpText="Optional GitHub token for the Copilot CLI. Leave empty to use your logged-in GitHub user."
			/>

			<VSCodeCheckbox
				checked={useLoggedInUser}
				onChange={(e: any) => handleFieldChange("copilotUseLoggedInUser", e.target.checked === true)}>
				Use logged-in GitHub user
			</VSCodeCheckbox>

			<DebouncedTextField
				initialValue={selectedModelId || ""}
				onChange={(value) =>
					handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, value, currentMode)
				}
				placeholder="Enter Model ID..."
				style={{ width: "100%", marginTop: 10 }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}

