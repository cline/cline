import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const TogetherOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.togetherApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("togetherApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.togetherModelId || ""}
				style={{ width: "100%", marginTop: 10 }}
				onInput={handleInputChange("togetherModelId")}
				placeholder={"Enter Model ID..."}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>
		</div>
	)
}

export default TogetherOptions
