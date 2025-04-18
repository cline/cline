import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const RequestyOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.requestyApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("requestyApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>
			{!apiConfiguration?.requestyApiKey && <a href="https://app.requesty.ai/manage-api">Get API Key</a>}
		</div>
	)
}

export default RequestyOptions
