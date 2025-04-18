import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const DeepseekOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.deepSeekApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("deepSeekApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>DeepSeek API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.deepSeekApiKey && (
					<VSCodeLink
						href="https://www.deepseek.com/"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a DeepSeek API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default DeepseekOptions
