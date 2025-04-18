import { memo, useCallback, useMemo } from "react"
import { ApiConfiguration } from "@shared/api"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import OpenRouterModelPicker from "./model/OpenRouterModelPicker"
import RequestyModelPicker from "./model/RequestyModelPicker"
import ProviderSelectDropdown from "./ProviderSelectDropdown"
import { normalizeApiConfiguration } from "@/utils/providers"
import * as ProviderOptions from "./providers"
import OpenRouterProviderSorter from "./OpenRouterProviderSorter"
import ModelPicker from "./model/ModelPicker"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
}

interface ProviderOptionKey {
	id: string
	component: keyof typeof ProviderOptions
}

const ApiOptions = ({ showModelOptions, apiErrorMessage, modelIdErrorMessage, isPopup }: ApiOptionsProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()

	const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
		const newValue = event.target.value

		// Update local state
		setApiConfiguration({
			...apiConfiguration,
			[field]: newValue,
		})

		// If the field is the provider, save it immediately
		// Necessary for favorite model selection to work without undoing provider changes
		if (field === "apiProvider") {
			vscode.postMessage({
				type: "apiConfiguration",
				apiConfiguration: {
					...apiConfiguration,
					apiProvider: newValue,
				},
			})
		}
	}

	const { selectedProvider, selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	const providerOptionsList: ProviderOptionKey[] = [
		{ id: "cline", component: "ClineOptions" },
		{ id: "asksage", component: "AskSageOptions" },
		{ id: "anthropic", component: "AnthropicOptions" },
		{ id: "openai-native", component: "OpenAIOptions" },
		{ id: "deepseek", component: "DeepseekOptions" },
		{ id: "qwen", component: "QwenOptions" },
		{ id: "doubao", component: "DoubaoOptions" },
		{ id: "mistral", component: "MistralOptions" },
		{ id: "openrouter", component: "OpenRouterOptions" },
		{ id: "bedrock", component: "BedrockOptions" },
		{ id: "vertex", component: "VertexOptions" },
		{ id: "gemini", component: "GeminiOptions" },
		{ id: "openai", component: "OpenAICompatOptions" },
		{ id: "requesty", component: "RequestyOptions" },
		{ id: "together", component: "TogetherOptions" },
		{ id: "vscode-lm", component: "VscodeLMOptions" },
		{ id: "lmstudio", component: "LMStudioOptions" },
		{ id: "litellm", component: "LiteLLMOptions" },
		{ id: "ollama", component: "OllamaOptions" },
		{ id: "xai", component: "XAIOptions" },
		{ id: "sambanova", component: "SambaNovaOptions" },
	]

	// Render the provider options based on the selected provider
	const renderProviderOptions = useCallback(() => {
		const providerOption = providerOptionsList.find((option) => option.id === selectedProvider)
		if (!providerOption) return null

		const ProviderOptionsComponent = ProviderOptions[providerOption.component]

		return <ProviderOptionsComponent handleInputChange={handleInputChange} />
	}, [selectedProvider, handleInputChange])

	const usesSpecialModelPickers = ["openrouter", "cline", "openai", "ollama", "lmstudio", "vscode-lm", "litellm", "requesty"]

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: isPopup ? -10 : 0 }}>
			<ProviderSelectDropdown selectedProvider={selectedProvider} onChange={handleInputChange("apiProvider")} />

			{renderProviderOptions()}

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

			{(selectedProvider === "openrouter" || selectedProvider === "cline") && showModelOptions && (
				<>
					<OpenRouterProviderSorter />
					<OpenRouterModelPicker isPopup={isPopup} />
				</>
			)}

			{selectedProvider === "requesty" && showModelOptions && <RequestyModelPicker isPopup={isPopup} />}

			{/* Default model picker for providers that aren't handled separately */}
			{!(selectedProvider in usesSpecialModelPickers) && showModelOptions && (
				<ModelPicker
					selectedProvider={selectedProvider}
					selectedModelId={selectedModelId}
					selectedModelInfo={selectedModelInfo}
					isPopup={isPopup}
					handleInputChange={handleInputChange}
				/>
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
