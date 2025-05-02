import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useState } from "react"

/**
 * Props for the LiteLLMProvider component
 */
interface LiteLLMProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The LiteLLM provider configuration component
 */
export const LiteLLMProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: LiteLLMProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Use type assertion to handle properties not defined in the interface
	const config = apiConfiguration as any

	// Helper for handling field changes that aren't properly typed
	const handleTypedField = (field: string) => (event: any) => {
		// Use type assertion to bypass TypeScript constraints
		handleInputChange(field as any)(event)
	}

	// State for showing auth fields
	const [showApiKeyField, setShowApiKeyField] = useState<boolean>(!!config?.liteLlmApiKey)

	return (
		<div>
			<VSCodeTextField
				value={config?.liteLlmBaseUrl || "http://localhost:8000"}
				style={{ width: "100%" }}
				type="url"
				onInput={handleTypedField("liteLlmBaseUrl")}
				placeholder="http://localhost:8000">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>

			<div style={{ marginTop: 10 }}>
				<VSCodeCheckbox
					checked={showApiKeyField}
					onChange={(e: any) => {
						const checked = e.target.checked
						setShowApiKeyField(checked)
						if (!checked) {
							handleTypedField("liteLlmApiKey")({ target: { value: "" } })
						}
					}}>
					LiteLLM Proxy requires authentication
				</VSCodeCheckbox>
			</div>

			{showApiKeyField && (
				<VSCodeTextField
					value={config?.liteLlmApiKey || ""}
					style={{ width: "100%", marginTop: 5 }}
					type="password"
					onInput={handleTypedField("liteLlmApiKey")}
					placeholder="Enter API Key...">
					<span style={{ fontWeight: 500 }}>API Key</span>
				</VSCodeTextField>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				LiteLLM is a unified interface to access many LLM APIs. Configure your LiteLLM proxy server URL and provide
				authentication if required.
			</p>

			{showModelOptions && (
				<>
					<VSCodeTextField
						value={config?.liteLlmModelId || ""}
						style={{ width: "100%", marginTop: 10 }}
						onInput={handleTypedField("liteLlmModelId")}
						placeholder="e.g. anthropic/claude-3-opus">
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						The model ID may be any model supported by your LiteLLM server. Examples: anthropic/claude-3-opus,
						openai/gpt-4, ollama/llama3
					</p>

					<ModelInfoView
						selectedModelId={selectedModelId || config?.liteLlmModelId || "litellm-model"}
						modelInfo={selectedModelInfo}
						isPopup={isPopup}
					/>
				</>
			)}
		</div>
	)
}
