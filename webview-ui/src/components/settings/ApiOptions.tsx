import { memo, useCallback, useMemo } from "react"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { ApiConfiguration, ApiProvider } from "@shared/api"
import { DropdownContainer } from "./common/ModelSelector"
import { ErrorMessage } from "./common/ErrorMessage"
import { normalizeApiConfiguration } from "./utils/providerUtils"

// Import provider components
import { AnthropicProvider } from "./providers/AnthropicProvider"
import { OpenRouterProvider } from "./providers/OpenRouterProvider"
import { GeminiProvider } from "./providers/GeminiProvider"
import { BedrockProvider } from "./providers/BedrockProvider"
import { OpenAICompatibleProvider } from "./providers/OpenAICompatibleProvider"
import { OllamaProvider } from "./providers/OllamaProvider"
import { MistralProvider } from "./providers/MistralProvider"
import { OpenAINativeProvider } from "./providers/OpenAINativeProvider"
import { DeepSeekProvider } from "./providers/DeepSeekProvider"
import { VertexProvider } from "./providers/VertexProvider"
import { VSCodeLMProvider } from "./providers/VSCodeLMProvider"
import { ClineProvider } from "./providers/ClineProvider"
import { RequestyProvider } from "./providers/RequestyProvider"
import { TogetherProvider } from "./providers/TogetherProvider"
import { QwenProvider } from "./providers/QwenProvider"
import { DoubaoProvider } from "./providers/DoubaoProvider"
import { LMStudioProvider } from "./providers/LMStudioProvider"
import { LiteLLMProvider } from "./providers/LiteLLMProvider"
import { AskSageProvider } from "./providers/AskSageProvider"
import { XAIProvider } from "./providers/XAIProvider"
import { SambanovaProvider } from "./providers/SambanovaProvider"

// Define the dropdown's z-index
const DROPDOWN_Z_INDEX = 1010 // Higher than the OpenRouterModelPicker's and ModelSelectorTooltip's z-index

/**
 * Props for the ApiOptions component
 */
interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
	saveImmediately?: boolean
}

/**
 * The main API Options component that allows users to configure API providers
 */
const ApiOptions = ({
	showModelOptions,
	apiErrorMessage,
	modelIdErrorMessage,
	isPopup,
	saveImmediately = false,
}: ApiOptionsProps) => {
	// Use full context state for immediate save payload
	const extensionState = useExtensionState()
	const { apiConfiguration, setApiConfiguration, uriScheme } = extensionState

	// Create a handler for input changes
	const handleInputChange = useCallback(
		(field: keyof ApiConfiguration) => (event: any) => {
			const newValue = event.target.value

			// Update local state
			setApiConfiguration({
				...apiConfiguration,
				[field]: newValue,
			})

			// If the field is the provider AND saveImmediately is true, save it immediately
			if (saveImmediately && field === "apiProvider") {
				// Use apiConfiguration from the full extensionState context
				const currentFullApiConfig = extensionState.apiConfiguration
				vscode.postMessage({
					type: "apiConfiguration",
					apiConfiguration: {
						...currentFullApiConfig, // Send the most complete config available
						apiProvider: newValue, // Override with the new provider
					},
				})
			}
		},
		[apiConfiguration, extensionState, saveImmediately, setApiConfiguration],
	)

	// Get the normalized configuration
	const { selectedProvider } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: isPopup ? -10 : 0 }}>
			{/* API Provider Selection Dropdown */}
			<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX}>
				<label htmlFor="api-provider">
					<span style={{ fontWeight: 500 }}>API Provider</span>
				</label>
				<VSCodeDropdown
					id="api-provider"
					value={selectedProvider}
					onChange={handleInputChange("apiProvider")}
					style={{ minWidth: 130, position: "relative" }}>
					<VSCodeOption value="cline">Cline</VSCodeOption>
					<VSCodeOption value="openrouter">OpenRouter</VSCodeOption>
					<VSCodeOption value="anthropic">Anthropic</VSCodeOption>
					<VSCodeOption value="bedrock">Amazon Bedrock</VSCodeOption>
					<VSCodeOption value="openai">OpenAI Compatible</VSCodeOption>
					<VSCodeOption value="vertex">GCP Vertex AI</VSCodeOption>
					<VSCodeOption value="gemini">Google Gemini</VSCodeOption>
					<VSCodeOption value="deepseek">DeepSeek</VSCodeOption>
					<VSCodeOption value="mistral">Mistral</VSCodeOption>
					<VSCodeOption value="openai-native">OpenAI</VSCodeOption>
					<VSCodeOption value="vscode-lm">VS Code LM API</VSCodeOption>
					<VSCodeOption value="requesty">Requesty</VSCodeOption>
					<VSCodeOption value="together">Together</VSCodeOption>
					<VSCodeOption value="qwen">Alibaba Qwen</VSCodeOption>
					<VSCodeOption value="doubao">Bytedance Doubao</VSCodeOption>
					<VSCodeOption value="lmstudio">LM Studio</VSCodeOption>
					<VSCodeOption value="ollama">Ollama</VSCodeOption>
					<VSCodeOption value="litellm">LiteLLM</VSCodeOption>
					<VSCodeOption value="asksage">AskSage</VSCodeOption>
					<VSCodeOption value="xai">xAI</VSCodeOption>
					<VSCodeOption value="sambanova">SambaNova</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>

			{/* Render appropriate provider component based on selection */}
			{apiConfiguration && selectedProvider === "anthropic" && (
				<AnthropicProvider
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

			{apiConfiguration && selectedProvider === "gemini" && (
				<GeminiProvider
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

			{apiConfiguration && selectedProvider === "ollama" && (
				<OllamaProvider
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

			{apiConfiguration && selectedProvider === "openai-native" && (
				<OpenAINativeProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
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

			{apiConfiguration && selectedProvider === "vertex" && (
				<VertexProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "vscode-lm" && (
				<VSCodeLMProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "cline" && (
				<ClineProvider
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

			{apiConfiguration && selectedProvider === "together" && (
				<TogetherProvider
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

			{apiConfiguration && selectedProvider === "lmstudio" && (
				<LMStudioProvider
					apiConfiguration={apiConfiguration}
					handleInputChange={handleInputChange}
					showModelOptions={showModelOptions}
					isPopup={isPopup}
				/>
			)}

			{apiConfiguration && selectedProvider === "litellm" && (
				<LiteLLMProvider
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

			{apiConfiguration && selectedProvider === "xai" && (
				<XAIProvider
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

			{/* Error messages */}
			{apiErrorMessage && <ErrorMessage message={apiErrorMessage} />}
			{modelIdErrorMessage && <ErrorMessage message={modelIdErrorMessage} />}
		</div>
	)
}

export default memo(ApiOptions)
