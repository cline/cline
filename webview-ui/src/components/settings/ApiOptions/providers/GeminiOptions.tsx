import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const GeminiOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.geminiApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("geminiApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>Gemini API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.geminiApiKey && (
					<VSCodeLink
						href="https://aistudio.google.com/apikey"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a Gemini API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default GeminiOptions
