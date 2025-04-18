import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import { useEffect } from "react"
import { vscode } from "@/utils/vscode"

const OllamaOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	// Request Ollama models when component mounts
	useEffect(() => {
		vscode.postMessage({
			type: "requestOllamaModels",
			text: apiConfiguration?.ollamaBaseUrl,
		})
	}, [apiConfiguration?.ollamaBaseUrl])

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.ollamaBaseUrl || ""}
				style={{ width: "100%" }}
				type="url"
				onInput={handleInputChange("ollamaBaseUrl")}
				placeholder={"Default: http://localhost:11434"}>
				<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.ollamaModelId || ""}
				style={{ width: "100%" }}
				onInput={handleInputChange("ollamaModelId")}
				placeholder={"e.g. llama3.1"}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				style={{ width: "100%" }}
				onInput={handleInputChange("ollamaApiOptionsCtxNum")}
				placeholder={"e.g. 32768"}>
				<span style={{ fontWeight: 500 }}>Model Context Window</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Ollama allows you to run models locally on your computer. For instructions on how to get started, see their
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide.
				</VSCodeLink>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>
		</div>
	)
}

export default OllamaOptions
