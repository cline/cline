import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the XAIProvider component
 */
interface XAIProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The xAI provider configuration component for Grok
 */
export const XAIProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: XAIProviderProps) => {
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
				value={config?.xaiApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleTypedField("xaiApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				xAI provides access to Grok, a conversational AI from the team at x.ai. This key is stored locally and only used
				to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<div style={{ marginTop: 10 }}>
						<label style={{ fontWeight: 500, display: "block", marginBottom: "4px" }}>Model</label>
						<div
							style={{
								padding: "7px 10px",
								backgroundColor: "var(--vscode-input-background)",
								border: "1px solid var(--vscode-input-border)",
								color: "var(--vscode-input-foreground)",
								borderRadius: "2px",
							}}>
							grok-1
						</div>
					</div>

					<ModelInfoView selectedModelId="grok-1" modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
