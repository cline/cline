import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the CustomProvider component
 */
interface CustomProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * A flexible custom provider configuration component
 */
export const CustomProvider = ({ showModelOptions, isPopup }: CustomProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.openAiBaseUrl || ""}
				onChange={(value) => handleFieldChange("openAiBaseUrl", value)}
				style={{ width: "100%" }}
				type="url"
				placeholder="https://api.example.com/v1">
				<span style={{ fontWeight: 500 }}>API Base URL</span>
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={apiConfiguration?.openAiApiKey || ""}
				onChange={(value) => handleFieldChange("openAiApiKey", value)}
				style={{ width: "100%" }}
				type="password"
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={apiConfiguration?.apiModelId || ""}
				onChange={(value) => handleFieldChange("apiModelId", value)}
				style={{ width: "100%" }}
				placeholder="e.g. gpt-4, claude-3-sonnet, etc.">
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Configure any OpenAI-compatible API endpoint. This is useful for local models, custom deployments, or other
				providers not explicitly supported.
			</p>

			{showModelOptions && (
				<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
			)}
		</div>
	)
}
