import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import { useCallback, useEffect, useState } from "react"
import { useEvent, useInterval } from "react-use"
import { vscode } from "@/utils/vscode"
import type { ExtensionMessage } from "@shared/ExtensionMessage"

const OllamaOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()
	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	// Request Ollama models
	const requestOllamaModels = useCallback(() => {
		vscode.postMessage({
			type: "requestOllamaModels",
			text: apiConfiguration?.ollamaBaseUrl,
		})
	}, [apiConfiguration?.ollamaBaseUrl])

	// Request Ollama models when component mounts
	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])

	// Poll Ollama models periodically
	useInterval(requestOllamaModels, 2000)

	// Handle message events for Ollama models
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "ollamaModels" && message.ollamaModels) {
			setOllamaModels(message.ollamaModels)
		}
	}, [])

	useEvent("message", handleMessage)

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
				style={{ width: "100%", marginTop: 10 }}
				onInput={handleInputChange("ollamaModelId")}
				placeholder={"e.g. llama3.1"}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				style={{ width: "100%", marginTop: 10 }}
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
