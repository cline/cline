import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { vscode } from "@/utils/vscode"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import {
	anthropicDefaultModelId,
	anthropicModels,
	ApiConfiguration,
	ApiProvider,
	askSageDefaultModelId,
	askSageDefaultURL,
	askSageModels,
	azureOpenAiDefaultApiVersion,
	bedrockDefaultModelId,
	bedrockModels,
	cerebrasDefaultModelId,
	cerebrasModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	doubaoDefaultModelId,
	doubaoModels,
	geminiDefaultModelId,
	geminiModels,
	internationalQwenDefaultModelId,
	internationalQwenModels,
	liteLlmModelInfoSaneDefaults,
	mainlandQwenDefaultModelId,
	mainlandQwenModels,
	mistralDefaultModelId,
	mistralModels,
	ModelInfo,
	nebiusDefaultModelId,
	nebiusModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	sambanovaDefaultModelId,
	sambanovaModels,
	vertexDefaultModelId,
	vertexGlobalModels,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
} from "@shared/api"
import { EmptyRequest, StringRequest } from "@shared/proto/common"
import { OpenAiModelsRequest } from "@shared/proto/models"
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
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInterval } from "react-use"
import styled from "styled-components"
import * as vscodemodels from "vscode"
import { useOpenRouterKeyInfo } from "../ui/hooks/useOpenRouterKeyInfo"
import { ClineAccountInfoCard } from "./ClineAccountInfoCard"
import OllamaModelPicker from "./OllamaModelPicker"
import OpenRouterModelPicker, { ModelDescriptionMarkdown, OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"
import RequestyModelPicker from "./RequestyModelPicker"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
	saveImmediately?: boolean // Add prop to control immediate saving
}

const OpenRouterBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { data: keyInfo, isLoading, error } = useOpenRouterKeyInfo(apiKey)

	if (isLoading) {
		return <span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>Loading...</span>
	}

	if (error || !keyInfo || keyInfo.limit === null) {
		// Don't show anything if there's an error, no info, or no limit set
		return null
	}

	// Calculate remaining balance
	const remainingBalance = keyInfo.limit - keyInfo.usage
	const formattedBalance = remainingBalance.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 4,
	})

	return (
		<VSCodeLink
			href="https://openrouter.ai/settings/keys"
			title={`Remaining balance: ${formattedBalance}\nLimit: ${keyInfo.limit.toLocaleString("en-US", { style: "currency", currency: "USD" })}\nUsage: ${keyInfo.usage.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
			style={{
				fontSize: "12px",
				color: "var(--vscode-foreground)",
				textDecoration: "none",
				fontWeight: 500,
				paddingLeft: 4,
				cursor: "pointer",
			}}>
			Balance: {formattedBalance}
		</VSCodeLink>
	)
}

// This is necessary to ensure dropdown opens downward, important for when this is used in popup
const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX + 2 // Higher than the OpenRouterModelPicker's and ModelSelectorTooltip's z-index

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
	const [lmstudioModels, setlmstudioModels] = useState<string[]>([])
	const [vsCodeLmModels, setVsCodeLmModels] = useState<vscodemodels.LanguageModelChatSelector[]>([])
	const [anthropicBaseUrlSelected, setAnthropicBaseUrlSelected] = useState(!!apiConfiguration?.anthropic?.baseUrl)
	const [geminiBaseUrlSelected, setGeminiBaseUrlSelected] = useState(!!apiConfiguration?.gemini?.baseUrl)
	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azure?.apiVersion)
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.aws?.bedrockEndpoint)
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.openrouter?.providerSorting)
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!apiConfiguration?.reasoningEffort)

	const handleInputChange = (field: string) => (event: any) => {
		const newValue = event.target.value

		// Map legacy field names to nested configuration structure
		const legacyToNestedMap: Record<string, { provider: string; field: string }> = {
			// Anthropic
			apiKey: { provider: "anthropic", field: "apiKey" },
			anthropicBaseUrl: { provider: "anthropic", field: "baseUrl" },

			// OpenAI
			openAiApiKey: { provider: "openai", field: "apiKey" },
			openAiModelId: { provider: "openai", field: "modelId" },
			openAiBaseUrl: { provider: "openai", field: "baseUrl" },
			openAiHeaders: { provider: "openai", field: "headers" },
			openAiModelInfo: { provider: "openai", field: "modelInfo" },

			// OpenAI Native
			openAiNativeApiKey: { provider: "openaiNative", field: "apiKey" },

			// OpenRouter
			openRouterApiKey: { provider: "openrouter", field: "apiKey" },
			openRouterModelId: { provider: "openrouter", field: "modelId" },
			openRouterModelInfo: { provider: "openrouter", field: "modelInfo" },
			openRouterProviderSorting: { provider: "openrouter", field: "providerSorting" },

			// Azure
			azureApiVersion: { provider: "azure", field: "apiVersion" },

			// AWS Bedrock
			awsAccessKey: { provider: "aws", field: "accessKey" },
			awsSecretKey: { provider: "aws", field: "secretKey" },
			awsSessionToken: { provider: "aws", field: "sessionToken" },
			awsRegion: { provider: "aws", field: "region" },
			awsUseCrossRegionInference: { provider: "aws", field: "useCrossRegionInference" },
			awsBedrockUsePromptCache: { provider: "aws", field: "bedrockUsePromptCache" },
			awsBedrockEndpoint: { provider: "aws", field: "bedrockEndpoint" },
			awsProfile: { provider: "aws", field: "profile" },
			awsUseProfile: { provider: "aws", field: "useProfile" },
			awsBedrockCustomSelected: { provider: "aws", field: "bedrockCustomSelected" },
			awsBedrockCustomModelBaseId: { provider: "aws", field: "bedrockCustomModelBaseId" },

			// Ollama
			ollamaModelId: { provider: "ollama", field: "modelId" },
			ollamaBaseUrl: { provider: "ollama", field: "baseUrl" },
			ollamaApiOptionsCtxNum: { provider: "ollama", field: "apiOptionsCtxNum" },

			// LM Studio
			"lmstudio?ModelId": { provider: "lmstudio?", field: "modelId" },
			"lmstudio?BaseUrl": { provider: "lmstudio?", field: "baseUrl" },

			// VS Code LM
			"vscode.modelSelector": { provider: "vscode", field: "modelSelector" },

			// LiteLLM
			liteLlmModelId: { provider: "litellm", field: "modelId" },
			liteLlmBaseUrl: { provider: "litellm", field: "baseUrl" },
			liteLlmApiKey: { provider: "litellm", field: "apiKey" },
			liteLlmUsePromptCache: { provider: "litellm", field: "usePromptCache" },
			liteLlmModelInfo: { provider: "litellm", field: "modelInfo" },

			// Requesty
			requestyModelId: { provider: "requesty", field: "modelId" },
			requestyApiKey: { provider: "requesty", field: "apiKey" },
			requestyModelInfo: { provider: "requesty", field: "modelInfo" },

			// Fireworks
			fireworksModelId: { provider: "fireworks", field: "modelId" },
			fireworksApiKey: { provider: "fireworks", field: "apiKey" },
			fireworksModelMaxCompletionTokens: { provider: "fireworks", field: "modelMaxCompletionTokens" },
			fireworksModelMaxTokens: { provider: "fireworks", field: "modelMaxTokens" },

			// Together
			togetherModelId: { provider: "together", field: "modelId" },
			togetherApiKey: { provider: "together", field: "apiKey" },

			// Qwen
			qwenApiLine: { provider: "qwen", field: "apiLine" },
			qwenApiKey: { provider: "qwen", field: "apiKey" },

			// Doubao
			doubaoApiKey: { provider: "doubao", field: "apiKey" },

			// Mistral
			mistralApiKey: { provider: "mistral", field: "apiKey" },

			// Vertex
			vertexProjectId: { provider: "vertex", field: "projectId" },
			vertexRegion: { provider: "vertex", field: "region" },

			// Gemini
			geminiApiKey: { provider: "gemini", field: "apiKey" },
			geminiBaseUrl: { provider: "gemini", field: "baseUrl" },

			// DeepSeek
			deepSeekApiKey: { provider: "deepseek", field: "apiKey" },

			// AskSage
			asksageApiUrl: { provider: "asksage", field: "apiUrl" },
			asksageApiKey: { provider: "asksage", field: "apiKey" },

			// Other Providers
			xaiApiKey: { provider: "xai", field: "apiKey" },
			nebiusApiKey: { provider: "nebius", field: "apiKey" },
			sambanovaApiKey: { provider: "sambanova", field: "apiKey" },
			cerebrasApiKey: { provider: "cerebras", field: "apiKey" },
			clineApiKey: { provider: "cline", field: "apiKey" },
		}

		// Update configuration based on field
		if (field === "apiProvider") {
			// Direct update for the provider field
			setApiConfiguration({
				...apiConfiguration,
				apiProvider: newValue,
			})
		} else if (field in legacyToNestedMap) {
			// Handle legacy field names with nested configuration
			const { provider, field: nestedField } = legacyToNestedMap[field]

			// Create a new nested configuration object
			const updatedConfig = {
				...apiConfiguration,
				[provider]: {
					...((apiConfiguration?.[provider as keyof ApiConfiguration] as object) || {}),
					[nestedField]: newValue,
				},
			}

			setApiConfiguration(updatedConfig)
		} else {
			// Direct update for fields not in the map
			setApiConfiguration({
				...apiConfiguration,
				[field]: newValue,
			})
		}

		// If the field is the provider AND saveImmediately is true, save it immediately using the full context state
		if (saveImmediately && field === "apiProvider") {
			// Use apiConfiguration from the full extensionState context to send the most complete data
			const currentFullApiConfig = extensionState.apiConfiguration
			vscode.postMessage({
				type: "apiConfiguration",
				apiConfiguration: {
					...currentFullApiConfig, // Send the most complete config available
					apiProvider: newValue, // Override with the new provider
				},
			})
		}
	}

	const { selectedProvider, selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	// Poll ollama/lmstudio? models
	const requestLocalModels = useCallback(async () => {
		if (selectedProvider === "ollama") {
			try {
				const response = await ModelsServiceClient.getOllamaModels(
					StringRequest.create({
						value: apiConfiguration?.ollama?.baseUrl || "",
					}),
				)
				if (response && response.values) {
					setOllamaModels(response.values)
				}
			} catch (error) {
				console.error("Failed to fetch Ollama models:", error)
				setOllamaModels([])
			}
		} else if (selectedProvider === "lmstudio") {
			try {
				const response = await ModelsServiceClient.getLmStudioModels(
					StringRequest.create({
						value: apiConfiguration?.lmstudio?.baseUrl || "",
					}),
				)
				if (response && response.values) {
					setlmstudioModels(response.values)
				}
			} catch (error) {
				console.error("Failed to fetch LM Studio models:", error)
				setlmstudioModels([])
			}
		} else if (selectedProvider === "vscode-lm") {
			try {
				const response = await ModelsServiceClient.getVsCodeLmModels(EmptyRequest.create({}))
				if (response && response.models) {
					setVsCodeLmModels(response.models)
				}
			} catch (error) {
				console.error("Failed to fetch VS Code LM models:", error)
				setVsCodeLmModels([])
			}
		}
	}, [selectedProvider, apiConfiguration?.ollama?.baseUrl, apiConfiguration?.lmstudio?.baseUrl])
	useEffect(() => {
		if (selectedProvider === "ollama" || selectedProvider === "lmstudio" || selectedProvider === "vscode-lm") {
			requestLocalModels()
		}
	}, [selectedProvider, requestLocalModels])
	useInterval(
		requestLocalModels,
		selectedProvider === "ollama" || selectedProvider === "lmstudio" || selectedProvider === "vscode-lm" ? 2000 : null,
	)

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

	// Debounced function to refresh OpenAI models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const debouncedRefreshOpenAiModels = useCallback((baseUrl?: string, apiKey?: string) => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		if (baseUrl && apiKey) {
			debounceTimerRef.current = setTimeout(() => {
				ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						baseUrl,
						apiKey,
					}),
				).catch((error) => {
					console.error("Failed to refresh OpenAI models:", error)
				})
			}, 500)
		}
	}, [])

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
					<VSCodeOption value="lmstudio?">LM Studio</VSCodeOption>
					<VSCodeOption value="ollama">Ollama</VSCodeOption>
					<VSCodeOption value="litellm">LiteLLM</VSCodeOption>
					<VSCodeOption value="nebius">Nebius AI Studio</VSCodeOption>
					<VSCodeOption value="asksage">AskSage</VSCodeOption>
					<VSCodeOption value="xai">xAI</VSCodeOption>
					<VSCodeOption value="sambanova">SambaNova</VSCodeOption>
					<VSCodeOption value="cerebras">Cerebras</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>

			{selectedProvider === "cline" && (
				<div style={{ marginBottom: 14, marginTop: 4 }}>
					<ClineAccountInfoCard />
				</div>
			)}

			{selectedProvider === "asksage" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.asksage?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("asksageApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>AskSage API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
					</p>
					<VSCodeTextField
						value={apiConfiguration?.asksage?.apiUrl || askSageDefaultURL}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("asksageApiUrl")}
						placeholder="Enter AskSage API URL...">
						<span style={{ fontWeight: 500 }}>AskSage API URL</span>
					</VSCodeTextField>
				</div>
			)}

			{selectedProvider === "anthropic" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.anthropic?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("apiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Anthropic API Key</span>
					</VSCodeTextField>

					<VSCodeCheckbox
						checked={anthropicBaseUrlSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setAnthropicBaseUrlSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									anthropic: {
										...apiConfiguration,
										baseUrl: "",
									},
								})
							}
						}}>
						Use custom base URL
					</VSCodeCheckbox>

					{anthropicBaseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.anthropic?.baseUrl || ""}
							style={{ width: "100%", marginTop: 3 }}
							type="url"
							onInput={handleInputChange("anthropicBaseUrl")}
							placeholder="Default: https://api.anthropic.com"
						/>
					)}

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.anthropic?.apiKey && (
							<VSCodeLink
								href="https://console.anthropic.com/settings/keys"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get an Anthropic API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "openai-native" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openaiNative?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("openAiNativeApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>OpenAI API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.openaiNative?.apiKey && (
							<VSCodeLink
								href="https://platform.openai.com/api-keys"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get an OpenAI API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "deepseek" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.deepseek?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("deepSeekApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>DeepSeek API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.deepseek?.apiKey && (
							<VSCodeLink
								href="https://www.deepseek.com/"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a DeepSeek API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "qwen" && (
				<div>
					<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
						<label htmlFor="qwen-line-provider">
							<span style={{ fontWeight: 500, marginTop: 5 }}>Alibaba API Line</span>
						</label>
						<VSCodeDropdown
							id="qwen-line-provider"
							value={apiConfiguration?.qwen?.apiLine || "china"}
							onChange={handleInputChange("qwenApiLine")}
							style={{
								minWidth: 130,
								position: "relative",
							}}>
							<VSCodeOption value="china">China API</VSCodeOption>
							<VSCodeOption value="international">International API</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						Please select the appropriate API interface based on your location. If you are in China, choose the China
						API interface. Otherwise, choose the International API interface.
					</p>
					<VSCodeTextField
						value={apiConfiguration?.qwen?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("qwenApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Qwen API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.qwen?.apiKey && (
							<VSCodeLink
								href="https://bailian.console.aliyun.com/"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a Qwen API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "doubao" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.doubao?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("doubaoApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Doubao API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.doubao?.apiKey && (
							<VSCodeLink
								href="https://console.volcengine.com/home"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a Doubao API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "mistral" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.mistral?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("mistralApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Mistral API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.mistral?.apiKey && (
							<VSCodeLink
								href="https://console.mistral.ai/codestral"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a Mistral API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "openrouter" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openrouter?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("openRouterApiKey")}
						placeholder="Enter API Key...">
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
							<span style={{ fontWeight: 500 }}>OpenRouter API Key</span>
							{apiConfiguration?.openrouter?.apiKey && (
								<OpenRouterBalanceDisplay apiKey={apiConfiguration.openrouter.apiKey} />
							)}
						</div>
					</VSCodeTextField>
					{!apiConfiguration?.openrouter?.apiKey && (
						<VSCodeButtonLink
							href={getOpenRouterAuthUrl(uriScheme)}
							style={{ margin: "5px 0 0 0" }}
							appearance="secondary">
							Get OpenRouter API Key
						</VSCodeButtonLink>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.{" "}
						{/* {!apiConfiguration?.openrouter?.apiKey && (
							<span style={{ color: "var(--vscode-charts-green)" }}>
								(<span style={{ fontWeight: 500 }}>Note:</span> OpenRouter is recommended for high rate
								limits, prompt caching, and wider selection of models.)
							</span>
						)} */}
					</p>
				</div>
			)}

			{selectedProvider === "bedrock" && (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 5,
					}}>
					<VSCodeRadioGroup
						value={apiConfiguration?.aws?.useProfile ? "profile" : "credentials"}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement)?.value
							const useProfile = value === "profile"
							setApiConfiguration({
								...apiConfiguration,
								aws: {
									...apiConfiguration?.aws,
									useProfile: useProfile,
								},
							})
						}}>
						<VSCodeRadio value="credentials">AWS Credentials</VSCodeRadio>
						<VSCodeRadio value="profile">AWS Profile</VSCodeRadio>
					</VSCodeRadioGroup>

					{apiConfiguration?.aws?.useProfile ? (
						<VSCodeTextField
							value={apiConfiguration?.aws?.profile || ""}
							style={{ width: "100%" }}
							onInput={handleInputChange("awsProfile")}
							placeholder="Enter profile name (default if empty)">
							<span style={{ fontWeight: 500 }}>AWS Profile Name</span>
						</VSCodeTextField>
					) : (
						<>
							<VSCodeTextField
								value={apiConfiguration?.aws?.accessKey || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsAccessKey")}
								placeholder="Enter Access Key...">
								<span style={{ fontWeight: 500 }}>AWS Access Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.aws?.secretKey || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsSecretKey")}
								placeholder="Enter Secret Key...">
								<span style={{ fontWeight: 500 }}>AWS Secret Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.aws?.sessionToken || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsSessionToken")}
								placeholder="Enter Session Token...">
								<span style={{ fontWeight: 500 }}>AWS Session Token</span>
							</VSCodeTextField>
						</>
					)}
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 1} className="dropdown-container">
						<label htmlFor="aws-region-dropdown">
							<span style={{ fontWeight: 500 }}>AWS Region</span>
						</label>
						<VSCodeDropdown
							id="aws-region-dropdown"
							value={apiConfiguration?.aws?.region || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("awsRegion")}>
							<VSCodeOption value="">Select a region...</VSCodeOption>
							{/* The user will have to choose a region that supports the model they use, but this shouldn't be a problem since they'd have to request access for it in that region in the first place. */}
							<VSCodeOption value="us-east-1">us-east-1</VSCodeOption>
							<VSCodeOption value="us-east-2">us-east-2</VSCodeOption>
							{/* <VSCodeOption value="us-west-1">us-west-1</VSCodeOption> */}
							<VSCodeOption value="us-west-2">us-west-2</VSCodeOption>
							{/* <VSCodeOption value="af-south-1">af-south-1</VSCodeOption> */}
							{/* <VSCodeOption value="ap-east-1">ap-east-1</VSCodeOption> */}
							<VSCodeOption value="ap-south-1">ap-south-1</VSCodeOption>
							<VSCodeOption value="ap-northeast-1">ap-northeast-1</VSCodeOption>
							<VSCodeOption value="ap-northeast-2">ap-northeast-2</VSCodeOption>
							<VSCodeOption value="ap-northeast-3">ap-northeast-3</VSCodeOption>
							<VSCodeOption value="ap-southeast-1">ap-southeast-1</VSCodeOption>
							<VSCodeOption value="ap-southeast-2">ap-southeast-2</VSCodeOption>
							<VSCodeOption value="ca-central-1">ca-central-1</VSCodeOption>
							<VSCodeOption value="eu-central-1">eu-central-1</VSCodeOption>
							<VSCodeOption value="eu-central-2">eu-central-2</VSCodeOption>
							<VSCodeOption value="eu-west-1">eu-west-1</VSCodeOption>
							<VSCodeOption value="eu-west-2">eu-west-2</VSCodeOption>
							<VSCodeOption value="eu-west-3">eu-west-3</VSCodeOption>
							<VSCodeOption value="eu-north-1">eu-north-1</VSCodeOption>
							{/* <VSCodeOption value="me-south-1">me-south-1</VSCodeOption> */}
							<VSCodeOption value="sa-east-1">sa-east-1</VSCodeOption>
							<VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption>
							<VSCodeOption value="us-gov-west-1">us-gov-west-1</VSCodeOption>
							{/* <VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption> */}
						</VSCodeDropdown>
					</DropdownContainer>

					<div style={{ display: "flex", flexDirection: "column" }}>
						<VSCodeCheckbox
							checked={awsEndpointSelected}
							onChange={(e: any) => {
								const isChecked = e.target.checked === true
								setAwsEndpointSelected(isChecked)
								if (!isChecked) {
									setApiConfiguration({
										aws: {
											...apiConfiguration,
											bedrockEndpoint: "",
										},
									})
								}
							}}>
							Use custom VPC endpoint
						</VSCodeCheckbox>

						{awsEndpointSelected && (
							<VSCodeTextField
								value={apiConfiguration?.aws?.bedrockEndpoint || ""}
								style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
								type="url"
								onInput={handleInputChange("awsBedrockEndpoint")}
								placeholder="Enter VPC Endpoint URL (optional)"
							/>
						)}

						<VSCodeCheckbox
							checked={apiConfiguration?.aws?.useCrossRegionInference || false}
							onChange={(e: any) => {
								const isChecked = e.target.checked === true
								setApiConfiguration({
									aws: {
										...apiConfiguration,
										useCrossRegionInference: isChecked,
									},
								})
							}}>
							Use cross-region inference
						</VSCodeCheckbox>

						{selectedModelInfo.supportsPromptCache && (
							<>
								<VSCodeCheckbox
									checked={apiConfiguration?.aws?.bedrockUsePromptCache || false}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										setApiConfiguration({
											aws: {
												...apiConfiguration,
												bedrockUsePromptCache: isChecked,
											},
										})
									}}>
									Use prompt caching
								</VSCodeCheckbox>
							</>
						)}
					</div>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						{apiConfiguration?.aws?.useProfile ? (
							<>
								Using AWS Profile credentials from ~/.aws/credentials. Leave profile name empty to use the default
								profile. These credentials are only used locally to make API requests from this extension.
							</>
						) : (
							<>
								Authenticate by either providing the keys above or use the default AWS credential providers, i.e.
								~/.aws/credentials or environment variables. These credentials are only used locally to make API
								requests from this extension.
							</>
						)}
					</p>
					<label htmlFor="bedrock-model-dropdown">
						<span style={{ fontWeight: 500 }}>Model</span>
					</label>
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
						<VSCodeDropdown
							id="bedrock-model-dropdown"
							value={apiConfiguration?.aws?.bedrockCustomSelected ? "custom" : selectedModelId}
							onChange={(e: any) => {
								const isCustom = e.target.value === "custom"
								setApiConfiguration({
									...apiConfiguration,
									apiModelId: isCustom ? "" : e.target.value,
									aws: {
										bedrockCustomSelected: isCustom,
										bedrockCustomModelBaseId: bedrockDefaultModelId,
									},
								})
							}}
							style={{ width: "100%" }}>
							<VSCodeOption value="">Select a model...</VSCodeOption>
							{Object.keys(bedrockModels).map((modelId) => (
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
							<VSCodeOption value="custom">Custom</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>
					{apiConfiguration?.aws?.bedrockCustomSelected && (
						<div>
							<p
								style={{
									fontSize: "12px",
									marginTop: "5px",
									color: "var(--vscode-descriptionForeground)",
								}}>
								Select "Custom" when using the Application Inference Profile in Bedrock. Enter the Application
								Inference Profile ARN in the Model ID field.
							</p>
							<label htmlFor="bedrock-model-input">
								<span style={{ fontWeight: 500 }}>Model ID</span>
							</label>
							<VSCodeTextField
								id="bedrock-model-input"
								value={apiConfiguration?.apiModelId || ""}
								style={{ width: "100%", marginTop: 3 }}
								onInput={handleInputChange("apiModelId")}
								placeholder="Enter custom model ID..."
							/>
							<label htmlFor="bedrock-base-model-dropdown">
								<span style={{ fontWeight: 500 }}>Base Inference Model</span>
							</label>
							<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 3} className="dropdown-container">
								<VSCodeDropdown
									id="bedrock-base-model-dropdown"
									value={apiConfiguration?.aws?.bedrockCustomModelBaseId || bedrockDefaultModelId}
									onChange={handleInputChange("awsBedrockCustomModelBaseId")}
									style={{ width: "100%" }}>
									<VSCodeOption value="">Select a model...</VSCodeOption>
									{Object.keys(bedrockModels).map((modelId) => (
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
							</DropdownContainer>
						</div>
					)}
					{(selectedModelId === "anthropic.claude-3-7-sonnet-20250219-v1:0" ||
						selectedModelId === "anthropic.claude-sonnet-4-20250514-v1:0" ||
						selectedModelId === "anthropic.claude-opus-4-20250514-v1:0" ||
						(apiConfiguration?.aws?.bedrockCustomSelected &&
							apiConfiguration?.aws?.bedrockCustomModelBaseId === "anthropic.claude-3-7-sonnet-20250219-v1:0") ||
						(apiConfiguration?.aws?.bedrockCustomSelected &&
							apiConfiguration?.aws?.bedrockCustomModelBaseId === "anthropic.claude-sonnet-4-20250514-v1:0") ||
						(apiConfiguration?.aws?.bedrockCustomSelected &&
							apiConfiguration?.aws?.bedrockCustomModelBaseId === "anthropic.claude-opus-4-20250514-v1:0")) && (
						<ThinkingBudgetSlider apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
					)}
					<ModelInfoView
						selectedModelId={selectedModelId}
						modelInfo={selectedModelInfo}
						isDescriptionExpanded={isDescriptionExpanded}
						setIsDescriptionExpanded={setIsDescriptionExpanded}
						isPopup={isPopup}
					/>
				</div>
			)}

			{apiConfiguration?.apiProvider === "vertex" && (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 5,
					}}>
					<VSCodeTextField
						value={apiConfiguration?.vertex?.projectId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("vertexProjectId")}
						placeholder="Enter Project ID...">
						<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
					</VSCodeTextField>
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 1} className="dropdown-container">
						<label htmlFor="vertex-region-dropdown">
							<span style={{ fontWeight: 500 }}>Google Cloud Region</span>
						</label>
						<VSCodeDropdown
							id="vertex-region-dropdown"
							value={apiConfiguration?.vertex?.region || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("vertexRegion")}>
							<VSCodeOption value="">Select a region...</VSCodeOption>
							<VSCodeOption value="us-east5">us-east5</VSCodeOption>
							<VSCodeOption value="us-central1">us-central1</VSCodeOption>
							<VSCodeOption value="europe-west1">europe-west1</VSCodeOption>
							<VSCodeOption value="europe-west4">europe-west4</VSCodeOption>
							<VSCodeOption value="asia-southeast1">asia-southeast1</VSCodeOption>
							<VSCodeOption value="global">global</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						To use Google Cloud Vertex AI, you need to
						<VSCodeLink
							href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
							style={{ display: "inline", fontSize: "inherit" }}>
							{"1) create a Google Cloud account › enable the Vertex AI API › enable the desired Claude models,"}
						</VSCodeLink>{" "}
						<VSCodeLink
							href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
							style={{ display: "inline", fontSize: "inherit" }}>
							{"2) install the Google Cloud CLI › configure Application Default Credentials."}
						</VSCodeLink>
					</p>
				</div>
			)}

			{selectedProvider === "gemini" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.gemini?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("geminiApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Gemini API Key</span>
					</VSCodeTextField>

					<VSCodeCheckbox
						checked={geminiBaseUrlSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setGeminiBaseUrlSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									gemini: {
										...apiConfiguration,
										baseUrl: "",
									},
								})
							}
						}}>
						Use custom base URL
					</VSCodeCheckbox>

					{geminiBaseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.gemini?.baseUrl || ""}
							style={{ width: "100%", marginTop: 3 }}
							type="url"
							onInput={handleInputChange("geminiBaseUrl")}
							placeholder="Default: https://generativelanguage.googleapis.com"
						/>
					)}

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.gemini?.apiKey && (
							<VSCodeLink
								href="https://aistudio.google.com/apikey"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a Gemini API key by signing up here.
							</VSCodeLink>
						)}
					</p>

					{/* Add Thinking Budget Slider specifically for gemini-2.5-flash-preview-04-17 */}
					{selectedProvider === "gemini" && selectedModelId === "gemini-2.5-flash-preview-04-17" && (
						<ThinkingBudgetSlider
							apiConfiguration={apiConfiguration}
							setApiConfiguration={setApiConfiguration}
							maxBudget={selectedModelInfo.thinkingConfig?.maxBudget}
						/>
					)}
				</div>
			)}

			{selectedProvider === "openai" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openai?.baseUrl || ""}
						style={{ width: "100%", marginBottom: 10 }}
						type="url"
						onInput={(e: any) => {
							const baseUrl = e.target.value
							handleInputChange("openAiBaseUrl")({ target: { value: baseUrl } })

							debouncedRefreshOpenAiModels(baseUrl, apiConfiguration?.openai?.apiKey)
						}}
						placeholder={"Enter base URL..."}>
						<span style={{ fontWeight: 500 }}>Base URL</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openai?.apiKey || ""}
						style={{ width: "100%", marginBottom: 10 }}
						type="password"
						onInput={(e: any) => {
							const apiKey = e.target.value
							handleInputChange("openAiApiKey")({ target: { value: apiKey } })

							debouncedRefreshOpenAiModels(apiConfiguration?.openai?.baseUrl, apiKey)
						}}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openai?.modelId || ""}
						style={{ width: "100%", marginBottom: 10 }}
						onInput={handleInputChange("openAiModelId")}
						placeholder={"Enter Model ID..."}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					{/* OpenAI Compatible Custom Headers */}
					{(() => {
						const headerEntries = Object.entries(apiConfiguration?.openai?.headers ?? {})
						return (
							<div style={{ marginBottom: 10 }}>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
									<span style={{ fontWeight: 500 }}>Custom Headers</span>
									<VSCodeButton
										onClick={() => {
											const currentHeaders = { ...(apiConfiguration?.openai?.headers || {}) }
											const headerCount = Object.keys(currentHeaders).length
											const newKey = `header${headerCount + 1}`
											currentHeaders[newKey] = ""
											handleInputChange("openAiHeaders")({
												target: {
													value: currentHeaders,
												},
											})
										}}>
										Add Header
									</VSCodeButton>
								</div>
								<div>
									{headerEntries.map(([key, value], index) => (
										<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
											<VSCodeTextField
												value={key}
												style={{ width: "40%" }}
												placeholder="Header name"
												onInput={(e: any) => {
													const currentHeaders = apiConfiguration?.openai?.headers ?? {}
													const newValue = e.target.value
													if (newValue && newValue !== key) {
														const { [key]: _, ...rest } = currentHeaders
														handleInputChange("openAiHeaders")({
															target: {
																value: {
																	...rest,
																	[newValue]: value,
																},
															},
														})
													}
												}}
											/>
											<VSCodeTextField
												value={value}
												style={{ width: "40%" }}
												placeholder="Header value"
												onInput={(e: any) => {
													handleInputChange("openAiHeaders")({
														target: {
															value: {
																...(apiConfiguration?.openai?.headers ?? {}),
																[key]: e.target.value,
															},
														},
													})
												}}
											/>
											<VSCodeButton
												appearance="secondary"
												onClick={() => {
													const { [key]: _, ...rest } = apiConfiguration?.openai?.headers ?? {}
													handleInputChange("openAiHeaders")({
														target: {
															value: rest,
														},
													})
												}}>
												Remove
											</VSCodeButton>
										</div>
									))}
								</div>
							</div>
						)
					})()}

					<VSCodeCheckbox
						checked={azureApiVersionSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setAzureApiVersionSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									azure: {
										...apiConfiguration,
										apiVersion: "",
									},
								})
							}
						}}>
						Set Azure API version
					</VSCodeCheckbox>
					{azureApiVersionSelected && (
						<VSCodeTextField
							value={apiConfiguration?.azure?.apiVersion || ""}
							style={{ width: "100%", marginTop: 3 }}
							onInput={handleInputChange("azureApiVersion")}
							placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
						/>
					)}
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
								checked={!!apiConfiguration?.openai?.modelInfo?.supportsImages}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									const modelInfo = apiConfiguration?.openai?.modelInfo
										? apiConfiguration.openai?.modelInfo
										: { ...openAiModelInfoSaneDefaults }
									modelInfo.supportsImages = isChecked
									setApiConfiguration({
										openai: {
											...(apiConfiguration?.openai || {}),
											modelInfo: modelInfo,
										},
									})
								}}>
								Supports Images
							</VSCodeCheckbox>
							<VSCodeCheckbox
								checked={!!apiConfiguration?.openai?.modelInfo?.supportsImages}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									let modelInfo = apiConfiguration?.openai?.modelInfo
										? apiConfiguration.openai?.modelInfo
										: { ...openAiModelInfoSaneDefaults }
									modelInfo.supportsImages = isChecked
									setApiConfiguration({
										openai: {
											...(apiConfiguration?.openai || {}),
											modelInfo: modelInfo,
										},
									})
								}}>
								Supports browser use
							</VSCodeCheckbox>
							<VSCodeCheckbox
								checked={!!apiConfiguration?.openai?.modelInfo?.isR1FormatRequired}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									let modelInfo = apiConfiguration?.openai?.modelInfo
										? apiConfiguration.openai?.modelInfo
										: { ...openAiModelInfoSaneDefaults }
									modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

									setApiConfiguration({
										openai: {
											...(apiConfiguration?.openai || {}),
											modelInfo: modelInfo,
										},
									})
								}}>
								Enable R1 messages format
							</VSCodeCheckbox>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.openai?.modelInfo?.contextWindow
											? apiConfiguration.openai?.modelInfo.contextWindow.toString()
											: openAiModelInfoSaneDefaults.contextWindow?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openai?.modelInfo
											? apiConfiguration.openai?.modelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.contextWindow = Number(input.target.value)
										setApiConfiguration({
											openai: {
												...(apiConfiguration?.openai || {}),
												modelInfo: modelInfo,
											},
										})
									}}>
									<span style={{ fontWeight: 500 }}>Context Window Size</span>
								</VSCodeTextField>
								<VSCodeTextField
									value={
										apiConfiguration?.openai?.modelInfo?.maxTokens
											? apiConfiguration.openai?.modelInfo.maxTokens.toString()
											: openAiModelInfoSaneDefaults.maxTokens?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openai?.modelInfo
											? apiConfiguration.openai?.modelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.maxTokens = input.target.value
										setApiConfiguration({
											openai: {
												...(apiConfiguration?.openai || {}),
												modelInfo: modelInfo,
											},
										})
									}}>
									<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
								</VSCodeTextField>
							</div>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.openai?.modelInfo?.inputPrice
											? apiConfiguration.openai?.modelInfo.inputPrice.toString()
											: openAiModelInfoSaneDefaults.inputPrice?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openai?.modelInfo
											? apiConfiguration.openai?.modelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.inputPrice = input.target.value
										setApiConfiguration({
											openai: {
												...(apiConfiguration?.openai || {}),
												modelInfo: modelInfo,
											},
										})
									}}>
									<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
								</VSCodeTextField>
								<VSCodeTextField
									value={
										apiConfiguration?.openai?.modelInfo?.outputPrice
											? apiConfiguration.openai?.modelInfo.outputPrice.toString()
											: openAiModelInfoSaneDefaults.outputPrice?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openai?.modelInfo
											? apiConfiguration.openai?.modelInfo
											: { ...openAiModelInfoSaneDefaults }
										modelInfo.outputPrice = input.target.value
										setApiConfiguration({
											openai: {
												...(apiConfiguration?.openai || {}),
												modelInfo: modelInfo,
											},
										})
									}}>
									<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
								</VSCodeTextField>
							</div>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.openai?.modelInfo?.temperature
											? apiConfiguration.openai?.modelInfo.temperature.toString()
											: openAiModelInfoSaneDefaults.temperature?.toString()
									}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.openai?.modelInfo
											? apiConfiguration.openai?.modelInfo
											: { ...openAiModelInfoSaneDefaults }

										// Check if the input ends with a decimal point or has trailing zeros after decimal
										const value = input.target.value
										const shouldPreserveFormat =
											value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

										modelInfo.temperature =
											value === ""
												? openAiModelInfoSaneDefaults.temperature
												: shouldPreserveFormat
													? value // Keep as string to preserve decimal format
													: parseFloat(value)

										setApiConfiguration({
											...apiConfiguration,
											openai: {
												...(apiConfiguration?.openai || {}),
												modelInfo: modelInfo,
											},
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
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "requesty" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.requesty?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("requestyApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					{!apiConfiguration?.requesty?.apiKey && <a href="https://app.requesty.ai/manage-api">Get API Key</a>}
				</div>
			)}

			{selectedProvider === "fireworks" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.fireworks?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("fireworksApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Fireworks API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.fireworks?.apiKey && (
							<VSCodeLink
								href="https://fireworks.ai/settings/users/api-keys"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a Fireworks API key by signing up here.
							</VSCodeLink>
						)}
					</p>
					<VSCodeTextField
						value={apiConfiguration?.fireworks?.modelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("fireworksModelId")}
						placeholder={"Enter Model ID..."}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
					<VSCodeTextField
						value={apiConfiguration?.fireworks?.modelMaxCompletionTokens?.toString() || ""}
						style={{ width: "100%", marginBottom: 8 }}
						onInput={(e) => {
							const value = (e.target as HTMLInputElement).value
							if (!value) {
								return
							}
							const num = parseInt(value, 10)
							if (isNaN(num)) {
								return
							}
							handleInputChange("fireworksModelMaxCompletionTokens")({
								target: {
									value: num,
								},
							})
						}}
						placeholder={"2000"}>
						<span style={{ fontWeight: 500 }}>Max Completion Tokens</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.fireworks?.modelMaxTokens?.toString() || ""}
						style={{ width: "100%", marginBottom: 8 }}
						onInput={(e) => {
							const value = (e.target as HTMLInputElement).value
							if (!value) {
								return
							}
							const num = parseInt(value)
							if (isNaN(num)) {
								return
							}
							handleInputChange("fireworksModelMaxTokens")({
								target: {
									value: num,
								},
							})
						}}
						placeholder={"4000"}>
						<span style={{ fontWeight: 500 }}>Max Context Tokens</span>
					</VSCodeTextField>
				</div>
			)}

			{selectedProvider === "together" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.together?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("togetherApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.together?.modelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("togetherModelId")}
						placeholder={"Enter Model ID..."}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "vscode-lm" && (
				<div>
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
						<label htmlFor="vscode-lm-model">
							<span style={{ fontWeight: 500 }}>Language Model</span>
						</label>
						{vsCodeLmModels.length > 0 ? (
							<VSCodeDropdown
								id="vscode-lm-model"
								value={
									apiConfiguration?.vscode?.modelSelector
										? `${apiConfiguration.vscode.modelSelector.vendor ?? ""}/${apiConfiguration.vscode.modelSelector.family ?? ""}`
										: ""
								}
								onChange={(e) => {
									const value = (e.target as HTMLInputElement).value
									if (!value) {
										return
									}
									const [vendor, family] = value.split("/")
									handleInputChange("vscode.modelSelector")({
										target: {
											value: { vendor, family },
										},
									})
								}}
								style={{ width: "100%" }}>
								<VSCodeOption value="">Select a model...</VSCodeOption>
								{vsCodeLmModels.map((model) => (
									<VSCodeOption
										key={`${model.vendor}/${model.family}`}
										value={`${model.vendor}/${model.family}`}>
										{model.vendor} - {model.family}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						) : (
							<p
								style={{
									fontSize: "12px",
									marginTop: "5px",
									color: "var(--vscode-descriptionForeground)",
								}}>
								The VS Code Language Model API allows you to run models provided by other VS Code extensions
								(including but not limited to GitHub Copilot). The easiest way to get started is to install the
								Copilot extension from the VS Marketplace and enabling Claude 3.7 Sonnet.
							</p>
						)}

						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-errorForeground)",
								fontWeight: 500,
							}}>
							Note: This is a very experimental integration and may not work as expected.
						</p>
					</DropdownContainer>
				</div>
			)}

			{selectedProvider === "lmstudio" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.lmstudio?.baseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("lmstudio?BaseUrl")}
						placeholder={"Default: http://localhost:1234"}>
						<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.lmstudio?.modelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("lmstudio?ModelId")}
						placeholder={"e.g. meta-llama-3.1-8b-instruct"}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					{lmstudioModels.length > 0 && (
						<VSCodeRadioGroup
							value={
								lmstudioModels.includes(apiConfiguration?.lmstudio?.modelId || "")
									? apiConfiguration?.lmstudio?.modelId
									: ""
							}
							onChange={(e) => {
								const value = (e.target as HTMLInputElement)?.value
								// need to check value first since radio group returns empty string sometimes
								if (value) {
									handleInputChange("lmstudio?ModelId")({
										target: { value },
									})
								}
							}}>
							{lmstudioModels.map((model) => (
								<VSCodeRadio key={model} value={model} checked={apiConfiguration?.lmstudio?.modelId === model}>
									{model}
								</VSCodeRadio>
							))}
						</VSCodeRadioGroup>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						LM Studio allows you to run models locally on your computer. For instructions on how to get started, see
						their
						<VSCodeLink href="https://lmstudio?.ai/docs" style={{ display: "inline", fontSize: "inherit" }}>
							quickstart guide.
						</VSCodeLink>
						You will also need to start LM Studio's{" "}
						<VSCodeLink
							href="https://lmstudio?.ai/docs/basics/server"
							style={{ display: "inline", fontSize: "inherit" }}>
							local server
						</VSCodeLink>{" "}
						feature to use it with this extension.{" "}
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "litellm" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.litellm?.baseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("liteLlmBaseUrl")}
						placeholder={"Default: http://localhost:4000"}>
						<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.litellm?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("liteLlmApiKey")}
						placeholder="Default: noop">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.litellm?.modelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("liteLlmModelId")}
						placeholder={"e.g. anthropic/claude-sonnet-4-20250514"}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					<div style={{ display: "flex", flexDirection: "column", marginTop: 10, marginBottom: 10 }}>
						{selectedModelInfo.supportsPromptCache && (
							<>
								<VSCodeCheckbox
									checked={apiConfiguration?.litellm?.usePromptCache || false}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										setApiConfiguration({
											litellm: {
												...apiConfiguration,
												usePromptCache: isChecked,
											},
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
								checked={!!apiConfiguration?.litellm?.modelInfo?.supportsImages}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									const modelInfo = apiConfiguration?.litellm?.modelInfo
										? apiConfiguration.litellm.modelInfo
										: { ...liteLlmModelInfoSaneDefaults }
									modelInfo.supportsImages = isChecked
									setApiConfiguration({
										litellm: {
											...apiConfiguration,
											modelInfo: modelInfo,
										},
									})
								}}>
								Supports Images
							</VSCodeCheckbox>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.litellm?.modelInfo?.contextWindow
											? apiConfiguration.litellm.modelInfo.contextWindow.toString()
											: liteLlmModelInfoSaneDefaults.contextWindow?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.litellm?.modelInfo
											? apiConfiguration.litellm.modelInfo
											: { ...liteLlmModelInfoSaneDefaults }
										modelInfo.contextWindow = Number(input.target.value)
										setApiConfiguration({
											litellm: {
												...apiConfiguration,
												modelInfo: modelInfo,
											},
										})
									}}>
									<span style={{ fontWeight: 500 }}>Context Window Size</span>
								</VSCodeTextField>
								<VSCodeTextField
									value={
										apiConfiguration?.litellm?.modelInfo?.maxTokens
											? apiConfiguration.litellm.modelInfo.maxTokens.toString()
											: liteLlmModelInfoSaneDefaults.maxTokens?.toString()
									}
									style={{ flex: 1 }}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.litellm?.modelInfo
											? apiConfiguration.litellm.modelInfo
											: { ...liteLlmModelInfoSaneDefaults }
										modelInfo.maxTokens = input.target.value
										setApiConfiguration({
											litellm: {
												...apiConfiguration,
												modelInfo: modelInfo,
											},
										})
									}}>
									<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
								</VSCodeTextField>
							</div>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<VSCodeTextField
									value={
										apiConfiguration?.litellm?.modelInfo?.temperature !== undefined
											? apiConfiguration.litellm.modelInfo.temperature.toString()
											: liteLlmModelInfoSaneDefaults.temperature?.toString()
									}
									onInput={(input: any) => {
										const modelInfo = apiConfiguration?.litellm?.modelInfo
											? apiConfiguration.litellm.modelInfo
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
											litellm: {
												...apiConfiguration,
												modelInfo: modelInfo,
											},
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

			{selectedProvider === "ollama" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.ollama?.baseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("ollamaBaseUrl")}
						placeholder={"Default: http://localhost:11434"}>
						<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
					</VSCodeTextField>

					{/* Model selection - use filterable picker */}
					<label htmlFor="ollama-model-selection">
						<span style={{ fontWeight: 500 }}>Model</span>
					</label>
					<OllamaModelPicker
						ollamaModels={ollamaModels}
						selectedModelId={apiConfiguration?.ollama?.modelId || ""}
						onModelChange={(modelId) => {
							setApiConfiguration({
								ollama: {
									...apiConfiguration?.ollama,
									modelId,
								},
							})
						}}
						placeholder={ollamaModels.length > 0 ? "Search and select a model..." : "e.g. llama3.1"}
					/>

					{/* Show status message based on model availability */}
					{ollamaModels.length === 0 && (
						<p
							style={{
								fontSize: "12px",
								marginTop: "3px",
								color: "var(--vscode-descriptionForeground)",
								fontStyle: "italic",
							}}>
							Unable to fetch models from Ollama server. Please ensure Ollama is running and accessible, or enter
							the model ID manually above.
						</p>
					)}

					<VSCodeTextField
						value={apiConfiguration?.ollama?.apiOptionsCtxNum || "32768"}
						style={{ width: "100%" }}
						onInput={handleInputChange("ollamaApiOptionsCtxNum")}
						placeholder={"e.g. 32768"}>
						<span style={{ fontWeight: 500 }}>Model Context Window</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Ollama allows you to run models locally on your computer. For instructions on how to get started, see
						their{" "}
						<VSCodeLink
							href="https://github.com/ollama/ollama/blob/main/README.md"
							style={{ display: "inline", fontSize: "inherit" }}>
							quickstart guide.
						</VSCodeLink>{" "}
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "nebius" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.nebius?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("nebiusApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Nebius API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.{" "}
						{!apiConfiguration?.nebius?.apiKey && (
							<VSCodeLink
								href="https://studio.nebius.com/settings/api-keys"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a Nebius API key by signing up here.{" "}
							</VSCodeLink>
						)}
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
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

			{selectedProvider === "xai" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.xai?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("xaiApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>X AI API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.xai?.apiKey && (
							<VSCodeLink href="https://x.ai" style={{ display: "inline", fontSize: "inherit" }}>
								You can get an X AI API key by signing up here.
							</VSCodeLink>
						)}
					</p>
					{/* Note: To fully implement this, you would need to add a handler in ClineProvider.ts */}
					{/* {apiConfiguration?.xai?.apiKey && (
						<button
							onClick={() => {
								vscode.postMessage({
									type: "requestXAIModels",
									text: apiConfiguration?.xai?.apiKey,
								})
							}}
							style={{ margin: "5px 0 0 0" }}
							className="vscode-button">
							Fetch Available Models
						</button>
					)} */}
				</div>
			)}

			{selectedProvider === "sambanova" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.sambanova?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("sambanovaApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>SambaNova API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.sambanova?.apiKey && (
							<VSCodeLink
								href="https://docs.sambanova.ai/cloud/docs/get-started/overview"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a SambaNova API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "cerebras" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.cerebras?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("cerebrasApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Cerebras API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.cerebras?.apiKey && (
							<VSCodeLink
								href="https://cloud.cerebras.ai/"
								style={{
									display: "inline",
									fontSize: "inherit",
								}}>
								You can get a Cerebras API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
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

			{selectedProvider === "ollama" && showModelOptions && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						style={{ width: "100%" }}
						onInput={(e: any) => {
							const value = e.target.value
							// Convert to number, with validation
							const numValue = parseInt(value, 10)
							if (!isNaN(numValue) && numValue > 0) {
								setApiConfiguration({
									...apiConfiguration,
									requestTimeoutMs: numValue,
								})
							}
						}}
						placeholder="Default: 30000 (30 seconds)">
						<span style={{ fontWeight: 500 }}>Request Timeout (ms)</span>
					</VSCodeTextField>
					<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
						Maximum time in milliseconds to wait for API responses before timing out.
					</p>
				</>
			)}

			{(selectedProvider === "openrouter" || selectedProvider === "cline") && showModelOptions && (
				<>
					<VSCodeCheckbox
						style={{ marginTop: -10 }}
						checked={providerSortingSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setProviderSortingSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									openrouter: {
										...apiConfiguration,
										providerSorting: "",
									},
								})
							}
						}}>
						Sort underlying provider routing
					</VSCodeCheckbox>

					{providerSortingSelected && (
						<div style={{ marginBottom: -6 }}>
							<DropdownContainer className="dropdown-container" zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX + 1}>
								<VSCodeDropdown
									style={{ width: "100%", marginTop: 3 }}
									value={apiConfiguration?.openrouter?.providerSorting}
									onChange={(e: any) => {
										setApiConfiguration({
											openrouter: {
												...apiConfiguration,
												providerSorting: e.target.value,
											},
										})
									}}>
									<VSCodeOption value="">Default</VSCodeOption>
									<VSCodeOption value="price">Price</VSCodeOption>
									<VSCodeOption value="throughput">Throughput</VSCodeOption>
									<VSCodeOption value="latency">Latency</VSCodeOption>
								</VSCodeDropdown>
							</DropdownContainer>
							<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
								{!apiConfiguration?.openrouter?.providerSorting &&
									"Default behavior is to load balance requests across providers (like AWS, Google Vertex, Anthropic), prioritizing price while considering provider uptime"}
								{apiConfiguration?.openrouter?.providerSorting === "price" &&
									"Sort providers by price, prioritizing the lowest cost provider"}
								{apiConfiguration?.openrouter?.providerSorting === "throughput" &&
									"Sort providers by throughput, prioritizing the provider with the highest throughput (may increase cost)"}
								{apiConfiguration?.openrouter?.providerSorting === "latency" &&
									"Sort providers by response time, prioritizing the provider with the lowest latency"}
							</p>
						</div>
					)}
				</>
			)}

			{selectedProvider !== "openrouter" &&
				selectedProvider !== "cline" &&
				selectedProvider !== "openai" &&
				selectedProvider !== "ollama" &&
				selectedProvider !== "lmstudio" &&
				selectedProvider !== "vscode-lm" &&
				selectedProvider !== "litellm" &&
				selectedProvider !== "requesty" &&
				selectedProvider !== "bedrock" &&
				showModelOptions && (
					<>
						<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
							<label htmlFor="model-id">
								<span style={{ fontWeight: 500 }}>Model</span>
							</label>
							{selectedProvider === "anthropic" && createDropdown(anthropicModels)}
							{selectedProvider === "vertex" &&
								createDropdown(apiConfiguration?.vertex?.region === "global" ? vertexGlobalModels : vertexModels)}
							{selectedProvider === "gemini" && createDropdown(geminiModels)}
							{selectedProvider === "openai-native" && createDropdown(openAiNativeModels)}
							{selectedProvider === "deepseek" && createDropdown(deepSeekModels)}
							{selectedProvider === "qwen" &&
								createDropdown(
									apiConfiguration?.qwen?.apiLine === "china" ? mainlandQwenModels : internationalQwenModels,
								)}
							{selectedProvider === "doubao" && createDropdown(doubaoModels)}
							{selectedProvider === "mistral" && createDropdown(mistralModels)}
							{selectedProvider === "asksage" && createDropdown(askSageModels)}
							{selectedProvider === "xai" && createDropdown(xaiModels)}
							{selectedProvider === "sambanova" && createDropdown(sambanovaModels)}
							{selectedProvider === "cerebras" && createDropdown(cerebrasModels)}
							{selectedProvider === "nebius" && createDropdown(nebiusModels)}
						</DropdownContainer>

						{selectedProvider === "anthropic" &&
							(selectedModelId === "claude-3-7-sonnet-20250219" ||
								selectedModelId === "claude-sonnet-4-20250514" ||
								selectedModelId === "claude-opus-4-20250514") && (
								<ThinkingBudgetSlider
									apiConfiguration={apiConfiguration}
									setApiConfiguration={setApiConfiguration}
								/>
							)}

						{selectedProvider === "vertex" &&
							(selectedModelId === "claude-3-7-sonnet@20250219" ||
								selectedModelId === "claude-sonnet-4@20250514" ||
								selectedModelId === "claude-opus-4@20250514") && (
								<ThinkingBudgetSlider
									apiConfiguration={apiConfiguration}
									setApiConfiguration={setApiConfiguration}
								/>
							)}

						{selectedProvider === "xai" && selectedModelId.includes("3-mini") && (
							<>
								<VSCodeCheckbox
									style={{ marginTop: 0 }}
									checked={reasoningEffortSelected}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										setReasoningEffortSelected(isChecked)
										if (!isChecked) {
											setApiConfiguration({
												...apiConfiguration,
												reasoningEffort: "",
											})
										}
									}}>
									Modify reasoning effort
								</VSCodeCheckbox>

								{reasoningEffortSelected && (
									<div>
										<label htmlFor="reasoning-effort-dropdown">
											<span style={{}}>Reasoning Effort</span>
										</label>
										<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 100}>
											<VSCodeDropdown
												id="reasoning-effort-dropdown"
												style={{ width: "100%", marginTop: 3 }}
												value={apiConfiguration?.reasoningEffort || "high"}
												onChange={(e: any) => {
													setApiConfiguration({
														...apiConfiguration,
														reasoningEffort: e.target.value,
													})
												}}>
												<VSCodeOption value="low">low</VSCodeOption>
												<VSCodeOption value="high">high</VSCodeOption>
											</VSCodeDropdown>
										</DropdownContainer>
										<p
											style={{
												fontSize: "12px",
												marginTop: 3,
												marginBottom: 0,
												color: "var(--vscode-descriptionForeground)",
											}}>
											High effort may produce more thorough analysis but takes longer and uses more tokens.
										</p>
									</div>
								)}
							</>
						)}
						<ModelInfoView
							selectedModelId={selectedModelId}
							modelInfo={selectedModelInfo}
							isDescriptionExpanded={isDescriptionExpanded}
							setIsDescriptionExpanded={setIsDescriptionExpanded}
							isPopup={isPopup}
						/>
					</>
				)}

			{(selectedProvider === "openrouter" || selectedProvider === "cline") && showModelOptions && (
				<OpenRouterModelPicker isPopup={isPopup} />
			)}
			{selectedProvider === "requesty" && showModelOptions && <RequestyModelPicker isPopup={isPopup} />}

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

export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${uriScheme || "vscode"}://saoudrizwan.claude-dev/openrouter`
}

export const formatPrice = (price: number) => {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(price)
}

// Returns an array of formatted tier strings
const formatTiers = (
	tiers: ModelInfo["tiers"],
	priceType: "inputPrice" | "outputPrice" | "cacheReadsPrice" | "cacheWritesPrice",
): JSX.Element[] => {
	if (!tiers || tiers.length === 0) {
		return []
	}

	return tiers
		.map((tier, index, arr) => {
			const prevLimit = index > 0 ? arr[index - 1].contextWindow : 0
			const price = tier[priceType]

			if (price === undefined) return null

			return (
				<span style={{ paddingLeft: "15px" }} key={index}>
					{formatPrice(price)}/million tokens (
					{tier.contextWindow === Number.POSITIVE_INFINITY ? (
						<span>
							{">"} {prevLimit.toLocaleString()}
						</span>
					) : (
						<span>
							{"<="} {tier.contextWindow.toLocaleString()}
						</span>
					)}
					{" tokens)"}
					{index < arr.length - 1 && <br />}
				</span>
			)
		})
		.filter((element): element is JSX.Element => element !== null)
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
	const hasThinkingConfig = !!modelInfo.thinkingConfig
	const hasTiers = !!modelInfo.tiers && modelInfo.tiers.length > 0

	// Create elements for input pricing
	const inputPriceElement = hasTiers ? (
		<Fragment key="inputPriceTiers">
			<span style={{ fontWeight: 500 }}>Input price:</span>
			<br />
			{formatTiers(modelInfo.tiers, "inputPrice")}
		</Fragment>
	) : modelInfo.inputPrice !== undefined && modelInfo.inputPrice > 0 ? (
		<span key="inputPrice">
			<span style={{ fontWeight: 500 }}>Input price:</span> {formatPrice(modelInfo.inputPrice)}/million tokens
		</span>
	) : null

	// --- Output Price Logic ---
	let outputPriceElement = null
	if (hasThinkingConfig && modelInfo.outputPrice !== undefined && modelInfo.thinkingConfig?.outputPrice !== undefined) {
		// Display both standard and thinking budget prices
		outputPriceElement = (
			<Fragment key="outputPriceConditional">
				<span style={{ fontWeight: 500 }}>Output price (Standard):</span> {formatPrice(modelInfo.outputPrice)}/million
				tokens
				<br />
				<span style={{ fontWeight: 500 }}>Output price (Thinking Budget &gt; 0):</span>{" "}
				{formatPrice(modelInfo.thinkingConfig.outputPrice)}/million tokens
			</Fragment>
		)
	} else if (hasTiers) {
		// Display tiered output pricing
		outputPriceElement = (
			<Fragment key="outputPriceTiers">
				<span style={{ fontWeight: 500 }}>Output price:</span>
				<span style={{ fontStyle: "italic" }}> (based on input tokens)</span>
				<br />
				{formatTiers(modelInfo.tiers, "outputPrice")}
			</Fragment>
		)
	} else if (modelInfo.outputPrice !== undefined && modelInfo.outputPrice > 0) {
		// Display single standard output price
		outputPriceElement = (
			<span key="outputPrice">
				<span style={{ fontWeight: 500 }}>Output price:</span> {formatPrice(modelInfo.outputPrice)}/million tokens
			</span>
		)
	}
	// --- End Output Price Logic ---

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
			key="supportsBrowserUse"
			isSupported={modelInfo.supportsImages ?? false} // cline browser tool uses image recognition for navigation (requires model image support).
			supportsLabel="Supports browser use"
			doesNotSupportLabel="Does not support browser use"
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

export function normalizeApiConfiguration(apiConfiguration?: ApiConfiguration): {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
} {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const modelId = apiConfiguration?.apiModelId

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: string) => {
		let selectedModelId: string
		let selectedModelInfo: ModelInfo
		if (modelId && modelId in models) {
			selectedModelId = modelId
			selectedModelInfo = models[modelId]
		} else {
			selectedModelId = defaultId
			selectedModelInfo = models[defaultId]
		}
		return {
			selectedProvider: provider,
			selectedModelId,
			selectedModelInfo,
		}
	}
	switch (provider) {
		case "anthropic":
			return getProviderData(anthropicModels, anthropicDefaultModelId)
		case "bedrock":
			if (apiConfiguration?.aws?.bedrockCustomSelected) {
				const baseModelId = apiConfiguration.aws?.bedrockCustomModelBaseId
				return {
					selectedProvider: provider,
					selectedModelId: modelId || bedrockDefaultModelId,
					selectedModelInfo: (baseModelId && bedrockModels[baseModelId]) || bedrockModels[bedrockDefaultModelId],
				}
			}
			return getProviderData(bedrockModels, bedrockDefaultModelId)
		case "vertex":
			return getProviderData(vertexModels, vertexDefaultModelId)
		case "gemini":
			return getProviderData(geminiModels, geminiDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "deepseek":
			return getProviderData(deepSeekModels, deepSeekDefaultModelId)
		case "qwen":
			const qwenModels = apiConfiguration?.qwen?.apiLine === "china" ? mainlandQwenModels : internationalQwenModels
			const qwenDefaultId =
				apiConfiguration?.qwen?.apiLine === "china" ? mainlandQwenDefaultModelId : internationalQwenDefaultModelId
			return getProviderData(qwenModels, qwenDefaultId)
		case "doubao":
			return getProviderData(doubaoModels, doubaoDefaultModelId)
		case "mistral":
			return getProviderData(mistralModels, mistralDefaultModelId)
		case "asksage":
			return getProviderData(askSageModels, askSageDefaultModelId)
		case "openrouter":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openrouter?.modelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openrouter?.modelInfo || openRouterDefaultModelInfo,
			}
		case "requesty":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.requesty?.modelId || requestyDefaultModelId,
				selectedModelInfo: apiConfiguration?.requesty?.modelInfo || requestyDefaultModelInfo,
			}
		case "cline":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openrouter?.modelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openrouter?.modelInfo || openRouterDefaultModelInfo,
			}
		case "openai":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openai?.modelId || "",
				selectedModelInfo: apiConfiguration?.openai?.modelInfo || openAiModelInfoSaneDefaults,
			}
		case "ollama":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.ollama?.modelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "lmstudio":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.lmstudio?.modelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "vscode-lm":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.vscode?.modelSelector
					? `${apiConfiguration.vscode.modelSelector.vendor}/${apiConfiguration.vscode.modelSelector.family}`
					: "",
				selectedModelInfo: {
					...openAiModelInfoSaneDefaults,
					supportsImages: false, // VSCode LM API currently doesn't support images
				},
			}
		case "litellm":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.litellm?.modelId || "",
				selectedModelInfo: apiConfiguration?.litellm?.modelInfo || liteLlmModelInfoSaneDefaults,
			}
		case "xai":
			return getProviderData(xaiModels, xaiDefaultModelId)
		case "nebius":
			return getProviderData(nebiusModels, nebiusDefaultModelId)
		case "sambanova":
			return getProviderData(sambanovaModels, sambanovaDefaultModelId)
		case "cerebras":
			return getProviderData(cerebrasModels, cerebrasDefaultModelId)
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

export default memo(ApiOptions)
