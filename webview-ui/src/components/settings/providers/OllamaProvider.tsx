import { StringRequest } from "@shared/proto/cline/common"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OllamaModelPicker from "../OllamaModelPicker"
import { getModeSpecificFields } from "../utils/providerUtils"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ showModelOptions, isPopup, currentMode }: OllamaProviderProps) => {
	const { apiConfiguration } = useExtensionState()

	const { ollamaModelId } = getModeSpecificFields(apiConfiguration, currentMode)

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
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={apiConfiguration?.ollamaBaseUrl}
				label="Use custom base URL"
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								options: {
									ollamaBaseUrl: value,
								},
							},
							updateMask: ["options.ollamaBaseUrl"],
						}),
					)
				}}
				placeholder="Default: http://localhost:11434"
			/>

			{apiConfiguration?.ollamaBaseUrl && (
				<ApiKeyField
					helpText="Optional API key for authenticated Ollama instances or cloud services. Leave empty for local installations."
					initialValue={apiConfiguration?.ollamaApiKey || ""}
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									secrets: {
										ollamaApiKey: value,
									},
								},
								updateMask: ["secrets.ollamaApiKey"],
							}),
						)
					}}
					placeholder="Enter API Key (optional)..."
					providerName="Ollama"
				/>
			)}

			{/* Model selection - use filterable picker */}
			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">Model</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onModelChange={async (modelId) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create(
							currentMode === "plan"
								? {
										updates: { options: { planModeOllamaModelId: modelId } },
										updateMask: ["options.planModeOllamaModelId"],
									}
								: {
										updates: { options: { actModeOllamaModelId: modelId } },
										updateMask: ["options.actModeOllamaModelId"],
									},
						),
					)
				}}
				placeholder={ollamaModels.length > 0 ? "Search and select a model..." : "e.g. llama3.1"}
				selectedModelId={ollamaModelId || ""}
			/>

			{/* Show status message based on model availability */}
			{ollamaModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">
					Unable to fetch models from Ollama server. Please ensure Ollama is running and accessible, or enter the model
					ID manually above.
				</p>
			)}

			<DebouncedTextField
				initialValue={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				onChange={async (v) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								options: {
									ollamaApiOptionsCtxNum: v || undefined,
								},
							},
							updateMask: ["options.ollamaApiOptionsCtxNum"],
						}),
					)
				}}
				placeholder={"e.g. 32768"}
				style={{ width: "100%" }}>
				<span className="font-semibold">Model Context Window</span>
			</DebouncedTextField>

			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						onChange={async (value) => {
							// Convert to number, with validation
							const numValue = parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue > 0) {
								await ModelsServiceClient.updateApiConfiguration(
									UpdateApiConfigurationRequestNew.create({
										updates: {
											options: {
												requestTimeoutMs: numValue,
											},
										},
										updateMask: ["options.requestTimeoutMs"],
									}),
								)
							}
						}}
						placeholder="Default: 30000 (30 seconds)"
						style={{ width: "100%" }}>
						<span className="font-semibold">Request Timeout (ms)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Maximum time in milliseconds to wait for API responses before timing out.
					</p>
				</>
			)}

			<UseCustomPromptCheckbox providerId="ollama" />

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
