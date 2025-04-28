import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField, VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"

/**
 * Props for the ClineProvider component
 */
interface ClineProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Cline provider configuration component
 */
export const ClineProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: ClineProviderProps) => {
	const selectedModel = apiConfiguration?.apiModelId || "claude-3-sonnet-20240229"

	// Helper to handle model selection
	const handleModelChange = (e: any) => {
		const value = e.target.value
		if (value) {
			handleInputChange("apiModelId")({ target: { value } })
		}
	}

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.clineApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("clineApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				The Cline API provides access to selected state-of-the-art language models. This key is stored locally and only
				used to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<div style={{ marginBottom: "8px", marginTop: "12px" }}>
						<label style={{ fontWeight: 500, display: "block", marginBottom: "4px" }}>Model</label>
						<VSCodeRadioGroup value={selectedModel} onChange={handleModelChange}>
							<VSCodeRadio value="claude-3-opus-20240229">Claude 3 Opus</VSCodeRadio>
							<VSCodeRadio value="claude-3-sonnet-20240229">Claude 3 Sonnet</VSCodeRadio>
							<VSCodeRadio value="claude-3-haiku-20240307">Claude 3 Haiku</VSCodeRadio>
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
							{selectedModel.includes("opus")
								? "Claude 3 Opus"
								: selectedModel.includes("sonnet")
									? "Claude 3 Sonnet"
									: "Claude 3 Haiku"}
						</h4>
						<div>Context Window: {selectedModel.includes("haiku") ? "48,000 tokens" : "200,000 tokens"}</div>
						<div>Max Output: {selectedModel.includes("haiku") ? "4,000 tokens" : "4,096 tokens"}</div>
						<div>
							Pricing:{" "}
							{selectedModel.includes("opus")
								? "$15.00 / 1M input tokens, $75.00 / 1M output tokens"
								: selectedModel.includes("sonnet")
									? "$3.00 / 1M input tokens, $15.00 / 1M output tokens"
									: "$0.25 / 1M input tokens, $1.25 / 1M output tokens"}
						</div>
					</div>
				</>
			)}
		</div>
	)
}
