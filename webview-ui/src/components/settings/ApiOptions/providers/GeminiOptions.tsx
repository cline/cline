import { VSCodeTextField, VSCodeLink, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import { useState } from "react"

const GeminiOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [geminiBaseUrlSelected, setGeminiBaseUrlSelected] = useState(!!apiConfiguration?.geminiBaseUrl)

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

			<VSCodeCheckbox
				checked={geminiBaseUrlSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					setGeminiBaseUrlSelected(isChecked)
					if (!isChecked) {
						setApiConfiguration({
							...apiConfiguration,
							geminiBaseUrl: "",
						})
					}
				}}>
				Use custom base URL
			</VSCodeCheckbox>

			{geminiBaseUrlSelected && (
				<VSCodeTextField
					value={apiConfiguration?.geminiBaseUrl || ""}
					style={{ width: "100%", marginTop: 3 }}
					type="url"
					onInput={handleInputChange("geminiBaseUrl")}
					placeholder="Default: https://generativelanguage.googleapis.com"
				/>
			)}

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
