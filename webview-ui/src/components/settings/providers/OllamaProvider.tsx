import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField, VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"
import { useEffect } from "react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { vscode } from "@/utils/vscode"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: OllamaProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Create a wrapper for handling field changes more directly
	const handleFieldChange = (field: keyof ApiConfiguration) => (value: string) => {
		handleInputChange(field)({ target: { value } })
	}

	// State for available Ollama models
	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	// Request Ollama models on load and periodically
	const requestLocalModels = () => {
		vscode.postMessage({
			type: "requestOllamaModels",
			text: apiConfiguration?.ollamaBaseUrl,
		})
	}

	useEffect(() => {
		// Request models on initial load
		requestLocalModels()

		// Set up interval to poll for models every 2 seconds
		const intervalId = setInterval(requestLocalModels, 2000)

		// Clean up interval on unmount
		return () => clearInterval(intervalId)
	}, [apiConfiguration?.ollamaBaseUrl])

	// Handle messages from the extension
	const handleMessage = (event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "ollamaModels" && message.ollamaModels) {
			setOllamaModels(message.ollamaModels)
		}
	}
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

			{ollamaModels.length > 0 && (
				<VSCodeRadioGroup
					value={ollamaModels.includes(apiConfiguration?.ollamaModelId || "") ? apiConfiguration?.ollamaModelId : ""}
					onChange={(e) => {
						const value = (e.target as HTMLInputElement)?.value
						// Need to check value first since radio group returns empty string sometimes
						if (value) {
							handleFieldChange("ollamaModelId")(value)
						}
					}}>
					{ollamaModels.map((model) => (
						<VSCodeRadio key={model} value={model} checked={apiConfiguration?.ollamaModelId === model}>
							{model}
						</VSCodeRadio>
					))}
				</VSCodeRadioGroup>
			)}

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

			{showModelOptions && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						style={{ width: "100%" }}
						onInput={(e: any) => {
							const value = e.target.value
							// Convert to number, with validation
							const numValue = parseInt(value, 10)
							if (!isNaN(numValue) && numValue > 0) {
								handleFieldChange("requestTimeoutMs")(numValue.toString())
							}
						}}
						placeholder="Default: 30000 (30 seconds)">
						<span style={{ fontWeight: 500 }}>Request Timeout (ms)</span>
					</VSCodeTextField>

					<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
						Maximum time in milliseconds to wait for API responses before timing out.
					</p>

					<ModelInfoView
						selectedModelId={selectedModelId || "local-model"}
						modelInfo={selectedModelInfo}
						isPopup={isPopup}
					/>
				</>
			)}
		</div>
	)
}

// Missing imports
import { useState } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
