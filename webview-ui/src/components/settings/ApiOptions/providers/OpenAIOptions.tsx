import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const OpenAIOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.openAiNativeApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("openAiNativeApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>OpenAI API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.openAiNativeApiKey && (
					<VSCodeLink
						href="https://platform.openai.com/api-keys"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get an OpenAI API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default OpenAIOptions
