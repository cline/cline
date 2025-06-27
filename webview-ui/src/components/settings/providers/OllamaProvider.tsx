import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useState, useCallback, useEffect } from "react"
import { useInterval } from "react-use"
import { ModelsServiceClient } from "@/services/grpc-client"
import { StringRequest } from "@shared/proto/common"
import OllamaModelPicker from "../OllamaModelPicker"
import { BaseUrlField } from "../common/BaseUrlField"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
	setApiConfiguration: (config: ApiConfiguration) => void
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({
	apiConfiguration,
	handleInputChange,
	showModelOptions,
	isPopup,
	setApiConfiguration,
}: OllamaProviderProps) => {
	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	// Poll ollama models
	const requestOllamaModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: apiConfiguration?.ollamaBaseUrl || "",
				}),
			)
			if (response && response.values) {
				setOllamaModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Ollama models:", error)
			setOllamaModels([])
		}
	}, [apiConfiguration?.ollamaBaseUrl])

	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])

	useInterval(requestOllamaModels, 2000)

	return (
		<div>
			<BaseUrlField
				value={apiConfiguration?.ollamaBaseUrl}
				onChange={(value) => handleInputChange("ollamaBaseUrl")({ target: { value } })}
				placeholder="Default: http://localhost:11434"
				label="Use custom base URL"
			/>

			{/* Model selection - use filterable picker */}
			<label htmlFor="ollama-model-selection">
				<span style={{ fontWeight: 500 }}>Model</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				selectedModelId={apiConfiguration?.ollamaModelId || ""}
				onModelChange={(modelId) => {
					setApiConfiguration({
						...apiConfiguration,
						ollamaModelId: modelId,
					})
				}}
				placeholder={ollamaModels.length > 0 ? "Search and select a model..." : "e.g. llama3.1"}
			/>

			{/* Show status message based on model availability */}
			{ollamaModels.length === 0 && (
				<p
					style={{
						fontSize: "12px",
						marginTop: "3px",
						color: "var(--vscode-descriptionForeground)",
						fontStyle: "italic",
					}}>
					Unable to fetch models from Ollama server. Please ensure Ollama is running and accessible, or enter the model
					ID manually above.
				</p>
			)}

			<VSCodeTextField
				value={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				style={{ width: "100%" }}
				onInput={handleInputChange("ollamaApiOptionsCtxNum")}
				placeholder={"e.g. 32768"}>
				<span style={{ fontWeight: 500 }}>Model Context Window</span>
			</VSCodeTextField>

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
								setApiConfiguration({
									...apiConfiguration,
									requestTimeoutMs: numValue,
								})
							}
						}}
						placeholder="Default: 30000 (30 seconds)">
						<span style={{ fontWeight: 500 }}>Request Timeout (ms)</span>
					</VSCodeTextField>
					<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
						Maximum time in milliseconds to wait for API responses before timing out.
					</p>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Ollama allows you to run models locally on your computer. For instructions on how to get started, see their{" "}
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide.
				</VSCodeLink>{" "}
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>
		</div>
	)
}
