import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const MistralOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.mistralApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("mistralApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>Mistral API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.mistralApiKey && (
					<VSCodeLink
						href="https://console.mistral.ai/codestral"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a Mistral API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default MistralOptions
