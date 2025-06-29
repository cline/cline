import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiConfiguration } from "@shared/api"
import { StringRequest } from "@shared/proto/common"
import { UpdateApiConfigurationRequest } from "@shared/proto/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import styled from "styled-components"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"

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
import { RequestyProvider } from "./providers/RequestyProvider"
import { FireworksProvider } from "./providers/FireworksProvider"
import { XaiProvider } from "./providers/XaiProvider"
import { CerebrasProvider } from "./providers/CerebrasProvider"
import { OllamaProvider } from "./providers/OllamaProvider"
import { ClaudeCodeProvider } from "./providers/ClaudeCodeProvider"
import { SapAiCoreProvider } from "./providers/SapAiCoreProvider"
import { BedrockProvider } from "./providers/BedrockProvider"
import { NebiusProvider } from "./providers/NebiusProvider"
import { LiteLlmProvider } from "./providers/LiteLlmProvider"
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

			{apiConfiguration && selectedProvider === "litellm" && (
				<LiteLlmProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
					setApiConfiguration={setApiConfiguration}
				/>
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
