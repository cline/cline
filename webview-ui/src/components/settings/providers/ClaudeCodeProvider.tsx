import { claudeCodeModels } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the ClaudeCodeProvider component
 */
interface ClaudeCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Claude Code provider configuration component
 */
export const ClaudeCodeProvider = ({ showModelOptions, isPopup }: ClaudeCodeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.claudeCodePath || ""}
				style={{ width: "100%", marginTop: 3 }}
				type="text"
				onInput={(e: any) => handleFieldChange("claudeCodePath", e.target.value)}
				placeholder="Default: claude">
				<span style={{ fontWeight: 500 }}>Claude Code CLI Path</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Path to the Claude Code CLI.
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						models={claudeCodeModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) => handleFieldChange("apiModelId", e.target.value)}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
