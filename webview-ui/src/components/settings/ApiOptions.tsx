import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiConfiguration, geminiModels, liteLlmModelInfoSaneDefaults, ModelInfo } from "@shared/api"
import { EmptyRequest, StringRequest } from "@shared/proto/common"
import { UpdateApiConfigurationRequest } from "@shared/proto/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import styled from "styled-components"
import * as vscodemodels from "vscode"
import OllamaModelPicker from "./OllamaModelPicker"
import OpenRouterModelPicker, { ModelDescriptionMarkdown, OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "./utils/providerUtils"

import { ClineProvider } from "./providers/ClineProvider"
import { OpenRouterProvider } from "./providers/OpenRouterProvider"
import { MistralProvider } from "./providers/MistralProvider"
import { DeepSeekProvider } from "./providers/DeepSeekProvider"
import { TogetherProvider } from "./providers/TogetherProvider"
import { OpenAICompatibleProvider } from "./providers/OpenAICompatible"
import { SambanovaProvider } from "./providers/SambanovaProvider"
import { AnthropicProvider } from "./providers/AnthropicProvider"
import { AskSageProvider } from "./providers/AskSageProvider"
import { OpenAINativeProvider } from "./providers/OpenAINative"
import { GeminiProvider } from "./providers/GeminiProvider"
import { DoubaoProvider } from "./providers/DoubaoProvider"
import { QwenProvider } from "./providers/QwenProvider"
import { VertexProvider } from "./providers/VertexProvider"
import GeminiCliProvider from "./providers/GeminiCliProvider"
import { RequestyProvider } from "./providers/RequestyProvider"
import { FireworksProvider } from "./providers/FireworksProvider"
import { XaiProvider } from "./providers/XaiProvider"
import { CerebrasProvider } from "./providers/CerebrasProvider"
import { OllamaProvider } from "./providers/OllamaProvider"
import { ClaudeCodeProvider } from "./providers/ClaudeCodeProvider"
import { SapAiCoreProvider } from "./providers/SapAiCoreProvider"
import { BedrockProvider } from "./providers/BedrockProvider"
import { NebiusProvider } from "./providers/NebiusProvider"
import { VSCodeLmProvider } from "./providers/VSCodeLmProvider"
import { LMStudioProvider } from "./providers/LMStudioProvider"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
	saveImmediately?: boolean // Add prop to control immediate saving
}

// This is necessary to ensure dropdown opens downward, important for when this is used in popup
export const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX + 2 // Higher than the OpenRouterModelPicker's and ModelSelectorTooltip's z-index

export const DropdownContainer = styled.div<{ zIndex?: number }>`
	position: relative;
	z-index: ${(props) => props.zIndex || DROPDOWN_Z_INDEX};

	// Force dropdowns to open downward
	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`

declare module "vscode" {
	interface LanguageModelChatSelector {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}
}

const ApiOptions = ({
	showModelOptions,
	apiErrorMessage,
	modelIdErrorMessage,
	isPopup,
	saveImmediately = false, // Default to false
}: ApiOptionsProps) => {
	// Use full context state for immediate save payload
	const extensionState = useExtensionState()
	const { apiConfiguration, setApiConfiguration, uriScheme } = extensionState
	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
		const newValue = event.target.value

		// Update local state
		setApiConfiguration({
			...apiConfiguration,
			[field]: newValue,
		})

		// If the field is the provider AND saveImmediately is true, save it immediately using the full context state
		if (saveImmediately && field === "apiProvider") {
			// Use apiConfiguration from the full extensionState context to send the most complete data
			const currentFullApiConfig = extensionState.apiConfiguration

			// Convert to proto format and send via gRPC
			const updatedConfig = {
				...currentFullApiConfig,
				apiProvider: newValue,
			}
			const protoConfig = convertApiConfigurationToProto(updatedConfig)
			ModelsServiceClient.updateApiConfigurationProto(
				UpdateApiConfigurationRequest.create({
					apiConfiguration: protoConfig,
				}),
			).catch((error) => {
				console.error("Failed to update API configuration:", error)
			})
		}
	}

	const { selectedProvider, selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	// Poll ollama/vscode-lm models
	const requestLocalModels = useCallback(async () => {
		if (selectedProvider === "ollama") {
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
		}
	}, [selectedProvider, apiConfiguration?.ollamaBaseUrl])
	useEffect(() => {
		if (selectedProvider === "ollama") {
			requestLocalModels()
		}
	}, [selectedProvider, requestLocalModels])
	useInterval(requestLocalModels, selectedProvider === "ollama" ? 2000 : null)

	/*
	VSCodeDropdown has an open bug where dynamically rendered options don't auto select the provided value prop. You can see this for yourself by comparing  it with normal select/option elements, which work as expected.
	https://github.com/microsoft/vscode-webview-ui-toolkit/issues/433

	In our case, when the user switches between providers, we recalculate the selectedModelId depending on the provider, the default model for that provider, and a modelId that the user may have selected. Unfortunately, the VSCodeDropdown component wouldn't select this calculated value, and would default to the first "Select a model..." option instead, which makes it seem like the model was cleared out when it wasn't.

	As a workaround, we create separate instances of the dropdown for each provider, and then conditionally render the one that matches the current provider.
	*/
	const createDropdown = (models: Record<string, ModelInfo>) => {
		return (
			<VSCodeDropdown
				id="model-id"
				value={selectedModelId}
				onChange={handleInputChange("apiModelId")}
				style={{ width: "100%" }}>
				<VSCodeOption value="">Select a model...</VSCodeOption>
				{Object.keys(models).map((modelId) => (
					<VSCodeOption
						key={modelId}
						value={modelId}
						style={{
							whiteSpace: "normal",
							wordWrap: "break-word",
							maxWidth: "100%",
						}}>
						{modelId}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: isPopup ? -10 : 0 }}>
			<DropdownContainer className="dropdown-container">
				<label htmlFor="api-provider">
					<span style={{ fontWeight: 500 }}>API Provider</span>
				</label>
				<VSCodeDropdown
					id="api-provider"
					value={selectedProvider}
					onChange={handleInputChange("apiProvider")}
					style={{
						minWidth: 130,
						position: "relative",
					}}>
					<VSCodeOption value="cline">Cline</VSCodeOption>
					<VSCodeOption value="openrouter">OpenRouter</VSCodeOption>
					<VSCodeOption value="anthropic">Anthropic</VSCodeOption>
					<VSCodeOption value="claude-code">Claude Code</VSCodeOption>
					<VSCodeOption value="bedrock">Amazon Bedrock</VSCodeOption>
					<VSCodeOption value="openai">OpenAI Compatible</VSCodeOption>
					<VSCodeOption value="vertex">GCP Vertex AI</VSCodeOption>
					<VSCodeOption value="gemini">Google Gemini</VSCodeOption>
					<VSCodeOption value="gemini-cli">Gemini CLI Provider</VSCodeOption>
					<VSCodeOption value="deepseek">DeepSeek</VSCodeOption>
					<VSCodeOption value="mistral">Mistral</VSCodeOption>
					<VSCodeOption value="openai-native">OpenAI</VSCodeOption>
					<VSCodeOption value="vscode-lm">VS Code LM API</VSCodeOption>
					<VSCodeOption value="requesty">Requesty</VSCodeOption>
					<VSCodeOption value="fireworks">Fireworks</VSCodeOption>
					<VSCodeOption value="together">Together</VSCodeOption>
					<VSCodeOption value="qwen">Alibaba Qwen</VSCodeOption>
					<VSCodeOption value="doubao">Bytedance Doubao</VSCodeOption>
					<VSCodeOption value="lmstudio">LM Studio</VSCodeOption>
					<VSCodeOption value="ollama">Ollama</VSCodeOption>
					<VSCodeOption value="litellm">LiteLLM</VSCodeOption>
					<VSCodeOption value="nebius">Nebius AI Studio</VSCodeOption>
					<VSCodeOption value="asksage">AskSage</VSCodeOption>
					<VSCodeOption value="xai">xAI</VSCodeOption>
					<VSCodeOption value="sambanova">SambaNova</VSCodeOption>
					<VSCodeOption value="cerebras">Cerebras</VSCodeOption>
					<VSCodeOption value="sapaicore">SAP AI Core</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>

			{apiConfiguration && selectedProvider === "cline" && (
				<ClineProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "asksage" && (
				<AskSageProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "anthropic" && (
				<AnthropicProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
			)}

			{apiConfiguration && selectedProvider === "claude-code" && (
				<ClaudeCodeProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "openai-native" && (
				<OpenAINativeProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "qwen" && (
				<QwenProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
			)}

			{apiConfiguration && selectedProvider === "doubao" && (
				<DoubaoProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "mistral" && (
				<MistralProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "openrouter" && (
				<OpenRouterProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					uriScheme={uriScheme}
				/>
			)}

			{apiConfiguration && selectedProvider === "deepseek" && (
				<DeepSeekProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "together" && (
				<TogetherProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "openai" && (
				<OpenAICompatibleProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "sambanova" && (
				<SambanovaProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "bedrock" && (
				<BedrockProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
			)}

			{apiConfiguration && selectedProvider === "vertex" && (
				<VertexProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
			)}

			{apiConfiguration && selectedProvider === "gemini" && (
				<GeminiProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
			)}

			{apiConfiguration && selectedProvider === "gemini-cli" && (
				<GeminiCliProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "requesty" && (
				<RequestyProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "fireworks" && (
				<FireworksProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "vscode-lm" && (
				<VSCodeLmProvider apiConfiguration={apiConfiguration} handleInputChange={handleInputChange} />
			)}

			{selectedProvider === "litellm" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.liteLlmBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("liteLlmBaseUrl")}
						placeholder={"Default: http://localhost:4000"}>
						<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.liteLlmApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("liteLlmApiKey")}
						placeholder="Default: noop">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.liteLlmModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("liteLlmModelId")}
						placeholder={"e.g. anthropic/claude-sonnet-4-20250514"}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					<div style={{ display: "flex", flexDirection: "column", marginTop: 10, marginBottom: 10 }}>
						{selectedModelInfo.supportsPromptCache && (
							<>
								<VSCodeCheckbox
									checked={apiConfiguration?.liteLlmUsePromptCache || false}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										setApiConfiguration({
											...apiConfiguration,
											liteLlmUsePromptCache: isChecked,
										})
									}}
									style={{ fontWeight: 500, color: "var(--vscode-charts-green)" }}>
									Use prompt caching (GA)
								</VSCodeCheckbox>
								<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-charts-green)" }}>
									Prompt caching requires a supported provider and model
								</p>
							</>
						)}
					</div>

					<>
						<ThinkingBudgetSlider apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
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
					</>

					<div
						style={{
							color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
							display: "flex",
							margin: "10px 0",
							cursor: "pointer",
							alignItems: "center",
						}}
						onClick={() => setModelConfigurationSelected((val) => !val)}>
						<span
							className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
							style={{
								marginRight: "4px",
							}}></span>
						<span
							style={{
								fontWeight: 700,
								textTransform: "uppercase",
							}}>
							Model Configuration
						</span>
					</div>
					{modelConfigurationSelected && (
						<>
							<VSCodeCheckbox
								checked={!!apiConfiguration?.liteLlmModelInfo?.supportsImages}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									const modelInfo = apiConfiguration?.liteLlmModelInfo
										? apiConfiguration.liteLlmModelInfo
										: { ...liteLlmModelInfoSaneDefaults }
									modelInfo.supportsImages = isChecked
									setApiConfiguration({
										...apiConfiguration,
										liteLlmModelInfo: modelInfo,
									})
								}}>
								Supports Images
							</VSCodeCheckbox>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.liteLlmModelInfo?.contextWindow
											? apiConfiguration.liteLlmModelInfo.contextWindow.toString()
											: liteLlmModelInfoSaneDefaults.contextWindow?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.liteLlmModelInfo
											? apiConfiguration.liteLlmModelInfo
											: { ...liteLlmModelInfoSaneDefaults }
										modelInfo.contextWindow = Number(input.target.value)
										setApiConfiguration({
											...apiConfiguration,
											liteLlmModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>Context Window Size</span>
								</VSCodeTextField>
								<VSCodeTextField
									value={
										apiConfiguration?.liteLlmModelInfo?.maxTokens
											? apiConfiguration.liteLlmModelInfo.maxTokens.toString()
											: liteLlmModelInfoSaneDefaults.maxTokens?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.liteLlmModelInfo
											? apiConfiguration.liteLlmModelInfo
											: { ...liteLlmModelInfoSaneDefaults }
										modelInfo.maxTokens = input.target.value
										setApiConfiguration({
											...apiConfiguration,
											liteLlmModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
								</VSCodeTextField>
							</div>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.liteLlmModelInfo?.temperature !== undefined
											? apiConfiguration.liteLlmModelInfo.temperature.toString()
											: liteLlmModelInfoSaneDefaults.temperature?.toString()
									}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.liteLlmModelInfo
											? apiConfiguration.liteLlmModelInfo
											: { ...liteLlmModelInfoSaneDefaults }

										// Check if the input ends with a decimal point or has trailing zeros after decimal
										const value = input.target.value
										const shouldPreserveFormat =
											value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

										modelInfo.temperature =
											value === ""
												? liteLlmModelInfoSaneDefaults.temperature
												: shouldPreserveFormat
													? value // Keep as string to preserve decimal format
													: parseFloat(value)

										setApiConfiguration({
											...apiConfiguration,
											liteLlmModelInfo: modelInfo,
										})
									}}>
									<span style={{ fontWeight: 500 }}>Temperature</span>
								</VSCodeTextField>
							</div>
						</>
					)}
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
			)}

			{apiConfiguration && selectedProvider === "lmstudio" && (
				<LMStudioProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "ollama" && (
				<OllamaProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
			)}

			{apiConfiguration && selectedProvider === "nebius" && (
				<NebiusProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "xai" && (
				<XaiProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
			)}

			{apiConfiguration && selectedProvider === "cerebras" && (
				<CerebrasProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "sapaicore" && (
				<SapAiCoreProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiErrorMessage && (
				<p
					style={{
						margin: "-10px 0 4px 0",
						fontSize: 12,
						color: "var(--vscode-errorForeground)",
					}}>
					{apiErrorMessage}
				</p>
			)}
			{modelIdErrorMessage && (
				<p
					style={{
						margin: "-10px 0 4px 0",
						fontSize: 12,
						color: "var(--vscode-errorForeground)",
					}}>
					{modelIdErrorMessage}
				</p>
			)}
		</div>
	)
}

export default memo(ApiOptions)
