import { Mode } from "@shared/storage/types"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the QwenCodeProvider component
 */
interface QwenCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Qwen Code provider configuration component
 */
export const QwenCodeProvider = ({ showModelOptions, isPopup, currentMode }: QwenCodeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"qwen-code",
		apiConfiguration,
		currentMode,
	)

	return (
		<div>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "8px 0" }}>Qwen Code API Configuration</h3>
			<VSCodeTextField
				onInput={(e: any) => handleFieldChange("qwenCodeOauthPath", e.target.value)}
				placeholder="~/.qwen/oauth_creds.json"
				style={{ width: "100%" }}
				value={apiConfiguration?.qwenCodeOauthPath || ""}>
				OAuth Credentials Path
			</VSCodeTextField>
			<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "4px" }}>
				Path to your Qwen OAuth credentials file. Use ~/.qwen/oauth_creds.json or provide a custom path.
			</div>

			<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "12px" }}>
				Qwen Code is an OAuth-based API that requires authentication through the official Qwen client. You'll need to set
				up OAuth credentials first.
			</div>

			<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "8px" }}>
				To get started:
				<br />
				1. Install the official Qwen client
				<br />
				2. Authenticate using your account
				<br />
				3. OAuth credentials will be stored automatically
			</div>

			<VSCodeLink
				href="https://github.com/QwenLM/qwen-code/blob/main/README.md"
				style={{
					color: "var(--vscode-textLink-foreground)",
					marginTop: "8px",
					display: "inline-block",
					fontSize: "12px",
				}}>
				Setup Instructions
			</VSCodeLink>

			{showModelOptions && (
				<>
					<ModelSelector
						label="模型"
						models={models}
						onChange={(modelId) => {
							const fieldName = currentMode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
							handleFieldChange(fieldName, modelId)
						}}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
