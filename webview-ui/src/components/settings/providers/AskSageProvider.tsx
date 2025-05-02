import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the AskSageProvider component
 */
interface AskSageProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The AskSage provider configuration component
 */
export const AskSageProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: AskSageProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Use type assertion to handle properties not defined in the interface
	const config = apiConfiguration as any

	// Helper for handling field changes that aren't properly typed
	const handleTypedField = (field: string) => (event: any) => {
		// Use type assertion to bypass TypeScript constraints
		handleInputChange(field as any)(event)
	}

	return (
		<div>
			<VSCodeTextField
				value={config?.askSageApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleTypedField("askSageApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={config?.askSageWorkspaceId || ""}
				style={{ width: "100%", marginTop: 10 }}
				onInput={handleTypedField("askSageWorkspaceId")}
				placeholder="Enter your Workspace ID">
				<span style={{ fontWeight: 500 }}>Workspace ID</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				AskSage is an AI platform that helps you effectively search and gather insights from your organization's
				knowledge. Get your API key from the AskSage dashboard. This key is stored locally and only used to make API
				requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<VSCodeRadioGroup
						style={{ marginTop: 10 }}
						value={config?.askSageModelId || "gpt-4o"}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement)?.value
							if (value) {
								handleTypedField("askSageModelId")({ target: { value } })
							}
						}}>
						<VSCodeRadio value="gpt-4o">GPT-4o</VSCodeRadio>
						<VSCodeRadio value="claude-3-opus">Claude 3 Opus</VSCodeRadio>
						<VSCodeRadio value="claude-3-sonnet">Claude 3 Sonnet</VSCodeRadio>
					</VSCodeRadioGroup>

					<ModelInfoView
						selectedModelId={selectedModelId || config?.askSageModelId || "gpt-4o"}
						modelInfo={selectedModelInfo}
						isPopup={isPopup}
					/>
				</>
			)}
		</div>
	)
}

// Add missing imports
import { VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"
