import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { CustomGatewayConfig, ModelInfo } from "../../../../src/shared/api"
import { vscode } from "../../utils/vscode"

interface ModelSourceConfigProps {
	config: CustomGatewayConfig
	onChange: (config: CustomGatewayConfig) => void
}

interface ModelListResponse {
	models: Array<{
		id: string
		name?: string
		description?: string
		maxTokens?: number
		contextWindow?: number
		supportsImages?: boolean
		inputPrice?: number
		outputPrice?: number
	}>
}

export const ModelSourceConfig = ({ config, onChange }: ModelSourceConfigProps) => {
	const [models, setModels] = useState<ModelListResponse["models"]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string>()

	const fetchModels = useCallback(async () => {
		if (!config.modelListSource) return

		setIsLoading(true)
		setError(undefined)

		try {
			// Request model list fetch through VSCode extension
			vscode.postMessage({
				type: "fetchCustomGatewayModels",
				modelListSource: config.modelListSource,
			})
		} catch (err) {
			setError("Failed to fetch models: " + (err instanceof Error ? err.message : String(err)))
			setIsLoading(false)
		}
	}, [config.modelListSource])

	// Listen for model list response from extension
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "customGatewayModels") {
				setModels(message.models || [])
				setIsLoading(false)
			} else if (message.type === "customGatewayModelsError") {
				setError(message.error)
				setIsLoading(false)
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	// Initial fetch when source is set
	useEffect(() => {
		if (config.modelListSource) {
			fetchModels()
		}
	}, [config.modelListSource, fetchModels])

	const handleModelSelect = (modelId: string) => {
		const selectedModel = models.find((m) => m.id === modelId)
		if (!selectedModel) return

		const modelInfo: ModelInfo = {
			maxTokens: selectedModel.maxTokens,
			contextWindow: selectedModel.contextWindow,
			supportsImages: selectedModel.supportsImages,
			supportsPromptCache: false, // Custom gateways don't support prompt caching yet
			inputPrice: selectedModel.inputPrice,
			outputPrice: selectedModel.outputPrice,
			description: selectedModel.description,
		}

		onChange({
			...config,
			defaultModel: {
				id: modelId,
				info: modelInfo,
			},
		})
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div style={{ display: "flex", gap: 5, alignItems: "flex-end" }}>
				<VSCodeTextField
					value={config.modelListSource || ""}
					style={{ flex: 1 }}
					onInput={(e) => {
						const target = e.target as HTMLInputElement
						onChange({
							...config,
							modelListSource: target.value,
						})
					}}
					placeholder="Enter URL or file path for model list">
					<span style={{ fontWeight: 500 }}>Model List Source</span>
				</VSCodeTextField>
				<VSCodeButton appearance="secondary" disabled={!config.modelListSource || isLoading} onClick={fetchModels}>
					{isLoading ? "Loading..." : "Refresh"}
				</VSCodeButton>
			</div>

			{error && <p style={{ color: "var(--vscode-errorForeground)", fontSize: 12, margin: 0 }}>{error}</p>}

			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				{models.length > 0 && (
					<div className="dropdown-container">
						<label htmlFor="model-select">
							<span style={{ fontWeight: 500 }}>Model from List</span>
						</label>
						<VSCodeDropdown
							id="model-select"
							value={config.defaultModel?.id || ""}
							style={{ width: "100%" }}
							onChange={(e) => handleModelSelect((e.target as HTMLSelectElement).value)}>
							<VSCodeOption value="">Select a model...</VSCodeOption>
							{models.map((model) => (
								<VSCodeOption key={model.id} value={model.id}>
									{model.name || model.id}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				)}

				<div>
					<VSCodeTextField
						value={config.defaultModel?.id || ""}
						style={{ width: "100%" }}
						onInput={(e) => {
							const target = e.target as HTMLInputElement
							onChange({
								...config,
								defaultModel: target.value
									? {
											id: target.value,
											info: {
												maxTokens: undefined,
												contextWindow: undefined,
												supportsImages: false,
												supportsPromptCache: false,
												inputPrice: undefined,
												outputPrice: undefined,
												description: undefined,
											},
										}
									: undefined,
							})
						}}
						placeholder="Enter custom model identifier">
						<span style={{ fontWeight: 500 }}>Custom Model ID</span>
					</VSCodeTextField>
				</div>
			</div>

			{config.defaultModel && (
				<div style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>
					<div>
						<span style={{ fontWeight: 500 }}>Selected Model:</span> {config.defaultModel.id}
					</div>
					{config.defaultModel.info.description && (
						<div style={{ marginTop: 3 }}>{config.defaultModel.info.description}</div>
					)}
					{config.defaultModel.info.maxTokens && (
						<div>
							<span style={{ fontWeight: 500 }}>Max Tokens:</span>{" "}
							{config.defaultModel.info.maxTokens.toLocaleString()}
						</div>
					)}
					{config.defaultModel.info.contextWindow && (
						<div>
							<span style={{ fontWeight: 500 }}>Context Window:</span>{" "}
							{config.defaultModel.info.contextWindow.toLocaleString()}
						</div>
					)}
					<div>
						<span style={{ fontWeight: 500 }}>Supports Images:</span>{" "}
						{config.defaultModel.info.supportsImages ? "Yes" : "No"}
					</div>
					{config.defaultModel.info.inputPrice && (
						<div>
							<span style={{ fontWeight: 500 }}>Input Price:</span> ${config.defaultModel.info.inputPrice}/million
							tokens
						</div>
					)}
					{config.defaultModel.info.outputPrice && (
						<div>
							<span style={{ fontWeight: 500 }}>Output Price:</span> ${config.defaultModel.info.outputPrice}/million
							tokens
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default ModelSourceConfig
