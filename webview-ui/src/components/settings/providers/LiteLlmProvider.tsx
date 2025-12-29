import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the LiteLlmProvider component
 */
interface LiteLlmProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const LiteLlmProvider = ({ showModelOptions, isPopup, currentMode }: LiteLlmProviderProps) => {
	const { apiConfiguration, liteLlmModels, refreshLiteLlmModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()

	// Get the normalized configuration with model info
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Refresh models when both base URL and API key are configured
	useEffect(() => {
		if (apiConfiguration?.liteLlmBaseUrl && apiConfiguration?.liteLlmApiKey) {
			refreshLiteLlmModels()
		}
	}, [refreshLiteLlmModels, apiConfiguration?.liteLlmApiKey, apiConfiguration?.liteLlmBaseUrl])

	// Handle model change
	const handleModelChange = (e: any) => {
		const newModelId = e.target.value
		const modelInfo = liteLlmModels[newModelId]

		handleModeFieldsChange(
			{
				liteLlmModelId: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
				liteLlmModelInfo: { plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
			},
			{
				liteLlmModelId: newModelId,
				liteLlmModelInfo: modelInfo,
			},
			currentMode,
		)
	}

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmBaseUrl || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								options: {
									liteLlmBaseUrl: value,
								},
							},
							updateMask: ["options.liteLlmBaseUrl"],
						}),
					)
				}}
				placeholder={"Default: http://localhost:4000"}
				style={{ width: "100%" }}
				type="text">
				<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
			</DebouncedTextField>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									liteLlmApiKey: value,
								},
							},
							updateMask: ["secrets.liteLlmApiKey"],
						}),
					)
				}}
				placeholder="Default: noop"
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</DebouncedTextField>
			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={liteLlmModels}
						onChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{selectedModelInfo?.supportsReasoning && <ThinkingBudgetSlider currentMode={currentMode} />}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Extended thinking is available for models such as Sonnet-4, o3-mini, Deepseek R1, etc. More info on{" "}
				<VSCodeLink
					href="https://docs.litellm.ai/docs/reasoning_content"
					style={{ display: "inline", fontSize: "inherit" }}>
					thinking mode configuration
				</VSCodeLink>
			</p>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				LiteLLM provides a unified interface to access various LLM providers' models. See their{" "}
				<VSCodeLink href="https://docs.litellm.ai/docs/" style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide
				</VSCodeLink>{" "}
				for more information.
			</p>
		</div>
	)
}
