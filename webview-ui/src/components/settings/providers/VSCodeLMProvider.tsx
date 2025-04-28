import { ApiConfiguration } from "@shared/api"
import { VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"

/**
 * Props for the VSCodeLMProvider component
 */
interface VSCodeLMProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The VS Code LM API provider configuration component
 */
export const VSCodeLMProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: VSCodeLMProviderProps) => {
	const selectedModel = apiConfiguration?.apiModelId || "copilot-gpt-3.5-turbo"

	// Helper to handle model selection
	const handleModelChange = (e: any) => {
		const value = e.target.value
		if (value) {
			handleInputChange("apiModelId")({ target: { value } })
		}
	}

	return (
		<div>
			<p
				style={{
					fontSize: "12px",
					marginBottom: "12px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				VS Code LM API uses the built-in VS Code language models. No additional configuration is required.
			</p>

			{showModelOptions && (
				<>
					<div style={{ marginBottom: "8px" }}>
						<label style={{ fontWeight: 500, display: "block", marginBottom: "4px" }}>Model</label>
						<VSCodeRadioGroup value={selectedModel} onChange={handleModelChange}>
							<VSCodeRadio value="copilot-gpt-3.5-turbo">GitHub Copilot Chat</VSCodeRadio>
							<VSCodeRadio value="vscode-default">VS Code Default LM</VSCodeRadio>
						</VSCodeRadioGroup>
					</div>

					<div
						style={{
							backgroundColor: "var(--vscode-editor-background)",
							border: "1px solid var(--vscode-editorWidget-border)",
							borderRadius: "4px",
							padding: "8px",
							marginTop: "10px",
							fontSize: "12px",
						}}>
						<h4 style={{ margin: "0 0 4px 0" }}>
							{selectedModel === "copilot-gpt-3.5-turbo" ? "GitHub Copilot Chat" : "VS Code Default LM"}
						</h4>
						<div>Context Window: {selectedModel === "copilot-gpt-3.5-turbo" ? "16,000 tokens" : "8,000 tokens"}</div>
						<div>Max Output: {selectedModel === "copilot-gpt-3.5-turbo" ? "4,000 tokens" : "2,000 tokens"}</div>
						<div>Pricing: Free (included with VS Code)</div>
					</div>
				</>
			)}
		</div>
	)
}
