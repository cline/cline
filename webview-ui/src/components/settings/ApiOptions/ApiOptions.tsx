import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react"
import { useEvent, useInterval } from "react-use"
import * as vscodemodels from "vscode"
import {
	ApiConfiguration,
	ApiProvider,
	azureOpenAiDefaultApiVersion,
	ModelInfo,
	openAiModelInfoSaneDefaults,
	askSageDefaultURL,
	geminiModels,
} from "@shared/api"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import OpenRouterModelPicker, { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../OpenRouterModelPicker"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import RequestyModelPicker from "../RequestyModelPicker"
import ProviderSelectDropdown from "./ProviderSelectDropdown"
import { normalizeApiConfiguration, formatTiers } from "@/utils/providers"
import * as ProviderOptions from "./providers"
import { formatPrice } from "@/utils/format"
import ModelDescriptionMarkdown from "../ModelDescriptionMarkdown"

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
	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azureApiVersion)
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpoint)
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.openRouterProviderSorting)
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!apiConfiguration?.reasoningEffort)

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
					<ProviderOptions.OpenAIOptions
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

export const ModelInfoView = ({
	selectedModelId,
	modelInfo,
	isDescriptionExpanded,
	setIsDescriptionExpanded,
	isPopup,
}: {
	selectedModelId: string
	modelInfo: ModelInfo
	isDescriptionExpanded: boolean
	setIsDescriptionExpanded: (isExpanded: boolean) => void
	isPopup?: boolean
}) => {
	const isGemini = Object.keys(geminiModels).includes(selectedModelId)

	// Create elements for tiered pricing separately
	const inputPriceElement = modelInfo.inputPriceTiers ? (
		<Fragment key="inputPriceTiers">
			<span style={{ fontWeight: 500 }}>Input price:</span>
			<br />
			{formatTiers(modelInfo.inputPriceTiers).map((tierString, i, arr) => (
				<Fragment key={`inputTierFrag${i}`}>
					<span style={{ paddingLeft: "15px" }}>{tierString}</span>
					{i < arr.length - 1 && <br />}
				</Fragment>
			))}
		</Fragment>
	) : modelInfo.inputPrice !== undefined && modelInfo.inputPrice > 0 ? (
		<span key="inputPrice">
			<span style={{ fontWeight: 500 }}>Input price:</span> {formatPrice(modelInfo.inputPrice)}/million tokens
		</span>
	) : null

	const outputPriceElement = modelInfo.outputPriceTiers ? (
		<Fragment key="outputPriceTiers">
			<span style={{ fontWeight: 500 }}>Output price:</span>
			<span style={{ fontStyle: "italic" }}> (based on input tokens)</span>
			<br />
			{formatTiers(modelInfo.outputPriceTiers).map((tierString, i, arr) => (
				<Fragment key={`outputTierFrag${i}`}>
					<span style={{ paddingLeft: "15px" }}>{tierString}</span>
					{i < arr.length - 1 && <br />}
				</Fragment>
			))}
		</Fragment>
	) : modelInfo.outputPrice !== undefined && modelInfo.outputPrice > 0 ? (
		<span key="outputPrice">
			<span style={{ fontWeight: 500 }}>Output price:</span> {formatPrice(modelInfo.outputPrice)}/million tokens
		</span>
	) : null

	const infoItems = [
		modelInfo.description && (
			<ModelDescriptionMarkdown
				key="description"
				markdown={modelInfo.description}
				isExpanded={isDescriptionExpanded}
				setIsExpanded={setIsDescriptionExpanded}
				isPopup={isPopup}
			/>
		),
		<ModelInfoSupportsItem
			key="supportsImages"
			isSupported={modelInfo.supportsImages ?? false}
			supportsLabel="Supports images"
			doesNotSupportLabel="Does not support images"
		/>,
		<ModelInfoSupportsItem
			key="supportsComputerUse"
			isSupported={modelInfo.supportsComputerUse ?? false}
			supportsLabel="Supports computer use"
			doesNotSupportLabel="Does not support computer use"
		/>,
		!isGemini && (
			<ModelInfoSupportsItem
				key="supportsPromptCache"
				isSupported={modelInfo.supportsPromptCache}
				supportsLabel="Supports prompt caching"
				doesNotSupportLabel="Does not support prompt caching"
			/>
		),
		modelInfo.maxTokens !== undefined && modelInfo.maxTokens > 0 && (
			<span key="maxTokens">
				<span style={{ fontWeight: 500 }}>Max output:</span> {modelInfo.maxTokens?.toLocaleString()} tokens
			</span>
		),
		inputPriceElement, // Add the generated input price block
		modelInfo.supportsPromptCache && modelInfo.cacheWritesPrice && (
			<span key="cacheWritesPrice">
				<span style={{ fontWeight: 500 }}>Cache writes price:</span> {formatPrice(modelInfo.cacheWritesPrice || 0)}
				/million tokens
			</span>
		),
		modelInfo.supportsPromptCache && modelInfo.cacheReadsPrice && (
			<span key="cacheReadsPrice">
				<span style={{ fontWeight: 500 }}>Cache reads price:</span> {formatPrice(modelInfo.cacheReadsPrice || 0)}/million
				tokens
			</span>
		),
		outputPriceElement, // Add the generated output price block
		isGemini && (
			<span key="geminiInfo" style={{ fontStyle: "italic" }}>
				* Free up to {selectedModelId && selectedModelId.includes("flash") ? "15" : "2"} requests per minute. After that,
				billing depends on prompt size.{" "}
				<VSCodeLink href="https://ai.google.dev/pricing" style={{ display: "inline", fontSize: "inherit" }}>
					For more info, see pricing details.
				</VSCodeLink>
			</span>
		),
	].filter(Boolean)

	return (
		<p
			style={{
				fontSize: "12px",
				marginTop: "2px",
				color: "var(--vscode-descriptionForeground)",
			}}>
			{infoItems.map((item, index) => (
				<Fragment key={index}>
					{item}
					{index < infoItems.length - 1 && <br />}
				</Fragment>
			))}
		</p>
	)
}

const ModelInfoSupportsItem = ({
	isSupported,
	supportsLabel,
	doesNotSupportLabel,
}: {
	isSupported: boolean
	supportsLabel: string
	doesNotSupportLabel: string
}) => (
	<span
		style={{
			fontWeight: 500,
			color: isSupported ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)",
		}}>
		<i
			className={`codicon codicon-${isSupported ? "check" : "x"}`}
			style={{
				marginRight: 4,
				marginBottom: isSupported ? 1 : -1,
				fontSize: isSupported ? 11 : 13,
				fontWeight: 700,
				display: "inline-block",
				verticalAlign: "bottom",
			}}></i>
		{isSupported ? supportsLabel : doesNotSupportLabel}
	</span>
)

export default memo(ApiOptions)
