import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const DoubaoOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.doubaoApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("doubaoApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>Doubao API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.doubaoApiKey && (
					<VSCodeLink
						href="https://console.volcengine.com/home"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a Doubao API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default DoubaoOptions
