import { ModelsServiceClient, StateServiceClient } from "@/services/grpc-client"
import { StringRequest, BooleanRequest } from "@shared/proto/common"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState, useMemo } from "react"
import { useInterval } from "react-use"
import styled from "styled-components"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"
import { validateApiConfiguration } from "@/utils/validate"

// Provider imports
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
	showSubmitButton?: boolean
	showModelOptions: boolean
	modelIdErrorMessage?: string
	isPopup?: boolean
}

export const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX + 2

export const DropdownContainer = styled.div<{ zIndex?: number }>`
	position: relative;
	z-index: ${(props) => props.zIndex || DROPDOWN_Z_INDEX};

	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`

// Provider options configuration
const PROVIDER_OPTIONS = [
	{ value: "cline", label: "Cline" },
	{ value: "openrouter", label: "OpenRouter" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "claude-code", label: "Claude Code" },
	{ value: "bedrock", label: "Amazon Bedrock" },
	{ value: "openai", label: "OpenAI Compatible" },
	{ value: "vertex", label: "GCP Vertex AI" },
	{ value: "gemini", label: "Google Gemini" },
	{ value: "deepseek", label: "DeepSeek" },
	{ value: "mistral", label: "Mistral" },
	{ value: "openai-native", label: "OpenAI" },
	{ value: "vscode-lm", label: "VS Code LM API" },
	{ value: "requesty", label: "Requesty" },
	{ value: "fireworks", label: "Fireworks" },
	{ value: "together", label: "Together" },
	{ value: "qwen", label: "Alibaba Qwen" },
	{ value: "doubao", label: "Bytedance Doubao" },
	{ value: "lmstudio", label: "LM Studio" },
	{ value: "ollama", label: "Ollama" },
	{ value: "litellm", label: "LiteLLM" },
	{ value: "nebius", label: "Nebius AI Studio" },
	{ value: "asksage", label: "AskSage" },
	{ value: "xai", label: "xAI" },
	{ value: "sambanova", label: "SambaNova" },
	{ value: "cerebras", label: "Cerebras" },
	{ value: "sapaicore", label: "SAP AI Core" },
] as const

// Provider component mapping
const PROVIDER_COMPONENTS = {
	cline: ClineProvider,
	asksage: AskSageProvider,
	anthropic: AnthropicProvider,
	"claude-code": ClaudeCodeProvider,
	"openai-native": OpenAINativeProvider,
	qwen: QwenProvider,
	doubao: DoubaoProvider,
	mistral: MistralProvider,
	openrouter: OpenRouterProvider,
	deepseek: DeepSeekProvider,
	together: TogetherProvider,
	openai: OpenAICompatibleProvider,
	sambanova: SambanovaProvider,
	bedrock: BedrockProvider,
	vertex: VertexProvider,
	gemini: GeminiProvider,
	requesty: RequestyProvider,
	fireworks: FireworksProvider,
	"vscode-lm": VSCodeLmProvider,
	litellm: LiteLlmProvider,
	lmstudio: LMStudioProvider,
	ollama: OllamaProvider,
	nebius: NebiusProvider,
	xai: XaiProvider,
	cerebras: CerebrasProvider,
	sapaicore: SapAiCoreProvider,
} as const

declare module "vscode" {
	interface LanguageModelChatSelector {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}
}

const ApiOptions = ({ showSubmitButton, showModelOptions, modelIdErrorMessage, isPopup }: ApiOptionsProps) => {
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	const { handleFieldChange, apiConfiguration, uriScheme } = useApiConfigurationHandlers()
	const selectedProvider = apiConfiguration?.apiProvider

	// Memoize validation to prevent unnecessary recalculations
	const validationError = useMemo(() => validateApiConfiguration(apiConfiguration), [apiConfiguration])

	useEffect(() => {
		setApiErrorMessage(validationError)
	}, [validationError])

	// Optimized Ollama models fetching
	const requestOllamaModels = useCallback(async () => {
		if (selectedProvider !== "ollama") return

		try {
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: apiConfiguration?.ollamaBaseUrl || "",
				}),
			)
			setOllamaModels(response?.values || [])
		} catch (error) {
			console.error("Failed to fetch Ollama models:", error)
			setOllamaModels([])
		}
	}, [selectedProvider, apiConfiguration?.ollamaBaseUrl])

	useEffect(() => {
		if (selectedProvider === "ollama") {
			requestOllamaModels()
		}
	}, [selectedProvider, requestOllamaModels])

	useInterval(requestOllamaModels, selectedProvider === "ollama" ? 2000 : null)

	const handleSubmit = useCallback(async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}, [])

	const handleProviderChange = useCallback(
		(e: any) => {
			handleFieldChange("apiProvider", e.target.value)
		},
		[handleFieldChange],
	)

	// Render provider component
	const renderProviderComponent = () => {
		if (!apiConfiguration || !selectedProvider) return null

		const ProviderComponent = PROVIDER_COMPONENTS[selectedProvider as keyof typeof PROVIDER_COMPONENTS]
		if (!ProviderComponent) return null

		const props = { showModelOptions, isPopup }

		// Special cases for providers that need additional props
		if (selectedProvider === "openrouter") {
			return <ProviderComponent {...props} uriScheme={uriScheme} />
		}

		if (apiConfiguration && selectedProvider === "vscode-lm") {
			return <VSCodeLmProvider />
		}

		return <ProviderComponent {...props} />
	}

	const disableLetsGoButton = apiErrorMessage != null

	return (
		<div className={`flex flex-col gap-1.5 ${isPopup ? "-mb-2.5" : "mb-0"}`}>
			<DropdownContainer className="dropdown-container">
				<label htmlFor="api-provider">
					<span className="font-medium">API Provider</span>
				</label>
				<VSCodeDropdown
					id="api-provider"
					value={selectedProvider}
					onChange={handleProviderChange}
					style={{ minWidth: 130, position: "relative" }}>
					{PROVIDER_OPTIONS.map(({ value, label }) => (
						<VSCodeOption key={value} value={value}>
							{label}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
			</DropdownContainer>

			{renderProviderComponent()}

			{apiErrorMessage && <p className="-mt-2.5 mb-1 text-xs text-[var(--vscode-errorForeground)]">{apiErrorMessage}</p>}

			{modelIdErrorMessage && (
				<p className="-mt-2.5 mb-1 text-xs text-[var(--vscode-errorForeground)]">{modelIdErrorMessage}</p>
			)}

			{showSubmitButton && (
				<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} className="mt-0.75">
					Let's go!
				</VSCodeButton>
			)}
		</div>
	)
}

export default ApiOptions
