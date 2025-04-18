import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useEvent, useInterval } from "react-use"
import * as vscodemodels from "vscode"
import { ApiConfiguration } from "@shared/api"
import { ExtensionMessage } from "@shared/ExtensionMessage"
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

declare module "vscode" {
	interface LanguageModelChatSelector {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}
}

const ApiOptions = ({ showModelOptions, apiErrorMessage, modelIdErrorMessage, isPopup }: ApiOptionsProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const [lmStudioModels, setLmStudioModels] = useState<string[]>([])
	const [vsCodeLmModels, setVsCodeLmModels] = useState<vscodemodels.LanguageModelChatSelector[]>([])

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

	// Poll ollama/lmstudio models
	const requestLocalModels = useCallback(() => {
		if (selectedProvider === "ollama") {
			vscode.postMessage({
				type: "requestOllamaModels",
				text: apiConfiguration?.ollamaBaseUrl,
			})
		} else if (selectedProvider === "lmstudio") {
			vscode.postMessage({
				type: "requestLmStudioModels",
				text: apiConfiguration?.lmStudioBaseUrl,
			})
		} else if (selectedProvider === "vscode-lm") {
			vscode.postMessage({ type: "requestVsCodeLmModels" })
		}
	}, [selectedProvider, apiConfiguration?.ollamaBaseUrl, apiConfiguration?.lmStudioBaseUrl])
	useEffect(() => {
		if (selectedProvider === "ollama" || selectedProvider === "lmstudio" || selectedProvider === "vscode-lm") {
			requestLocalModels()
		}
	}, [selectedProvider, requestLocalModels])
	useInterval(
		requestLocalModels,
		selectedProvider === "ollama" || selectedProvider === "lmstudio" || selectedProvider === "vscode-lm" ? 2000 : null,
	)

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "ollamaModels" && message.ollamaModels) {
			setOllamaModels(message.ollamaModels)
		} else if (message.type === "lmStudioModels" && message.lmStudioModels) {
			setLmStudioModels(message.lmStudioModels)
		} else if (message.type === "vsCodeLmModels" && message.vsCodeLmModels) {
			setVsCodeLmModels(message.vsCodeLmModels)
		}
	}, [])
	useEvent("message", handleMessage)

	// Render the provider options based on the selected provider
	const renderProviderOptions = useCallback(() => {
		switch (selectedProvider) {
			case "cline":
				return <ProviderOptions.ClineOptions />
			case "asksage":
				return (
					<ProviderOptions.AskSageOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "anthropic":
				return (
					<ProviderOptions.AnthropicOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "openai-native":
				return (
					<ProviderOptions.OpenAIOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "deepseek":
				return (
					<ProviderOptions.DeepseekOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "qwen":
				return (
					<ProviderOptions.QwenOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "doubao":
				return (
					<ProviderOptions.DoubaoOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "mistral":
				return (
					<ProviderOptions.MistralOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "openrouter":
				return (
					<ProviderOptions.OpenRouterOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "bedrock":
				return (
					<ProviderOptions.BedrockOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "vertex":
				return (
					<ProviderOptions.VertexOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "gemini":
				return (
					<ProviderOptions.GeminiOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "openai":
				return (
					<ProviderOptions.OpenAICompatOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "requesty":
				return (
					<ProviderOptions.RequestyOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "together":
				return (
					<ProviderOptions.TogetherOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "vscode-lm":
				return (
					<ProviderOptions.VscodeLMOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "lmstudio":
				return (
					<ProviderOptions.LMStudioOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "litellm":
				return (
					<ProviderOptions.LiteLLMOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "ollama":
				return (
					<ProviderOptions.OllamaOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "xai":
				return (
					<ProviderOptions.XAIOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			case "sambanova":
				return (
					<ProviderOptions.SambaNovaOptions
						showModelOptions={showModelOptions}
						isPopup={isPopup}
						handleInputChange={handleInputChange}
					/>
				)
			default:
				return null
		}
	}, [selectedProvider, showModelOptions, isPopup, handleInputChange])

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
				<OpenRouterProviderSorter />
			)}

			{(selectedProvider === "openrouter" || selectedProvider === "cline") && showModelOptions && (
				<OpenRouterModelPicker isPopup={isPopup} />
			)}

			{selectedProvider === "requesty" && showModelOptions && <RequestyModelPicker isPopup={isPopup} />}

			{/* Default model picker for providers that aren't handled separately */}
			{selectedProvider !== "openrouter" &&
				selectedProvider !== "cline" &&
				selectedProvider !== "openai" &&
				selectedProvider !== "ollama" &&
				selectedProvider !== "lmstudio" &&
				selectedProvider !== "vscode-lm" &&
				selectedProvider !== "litellm" &&
				selectedProvider !== "requesty" &&
				showModelOptions && (
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
