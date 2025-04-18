import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const SambaNovaOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.sambanovaApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("sambanovaApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>SambaNova API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.sambanovaApiKey && (
					<VSCodeLink
						href="https://sambanova.ai/"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a SambaNova API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default SambaNovaOptions
