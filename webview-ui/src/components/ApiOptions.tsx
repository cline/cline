import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useEvent, useInterval } from "react-use"
import {
	ApiConfiguration,
	ModelInfo,
	OpenAiNativeModelId,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	geminiDefaultModelId,
	geminiModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterModels,
	vertexDefaultModelId,
	vertexModels,
} from "../../../src/shared/api"
import { ExtensionMessage } from "../../../src/shared/ExtensionMessage"
import { useExtensionState } from "../context/ExtensionStateContext"
import { vscode } from "../utils/vscode"
import VSCodeButtonLink from "./VSCodeButtonLink"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
}

const ApiOptions = ({ showModelOptions, apiErrorMessage }: ApiOptionsProps) => {
	const { apiConfiguration, setApiConfiguration, uriScheme } = useExtensionState()
	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const [anthropicBaseUrlSelected, setAnthropicBaseUrlSelected] = useState(!!apiConfiguration?.anthropicBaseUrl)

	const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
		setApiConfiguration({ ...apiConfiguration, [field]: event.target.value })
	}

	const { selectedProvider, selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	// Poll ollama models
	const requestOllamaModels = useCallback(() => {
		if (selectedProvider === "ollama") {
			vscode.postMessage({ type: "requestOllamaModels", text: apiConfiguration?.ollamaBaseUrl })
		}
	}, [selectedProvider, apiConfiguration?.ollamaBaseUrl])
	useEffect(() => {
		if (selectedProvider === "ollama") {
			requestOllamaModels()
		}
	}, [selectedProvider, requestOllamaModels])
	useInterval(requestOllamaModels, selectedProvider === "ollama" ? 2000 : null)

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "ollamaModels" && message.models) {
			setOllamaModels(message.models)
		}
	}, [])
	useEvent("message", handleMessage)

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
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div className="dropdown-container">
				<label htmlFor="api-provider">
					<span style={{ fontWeight: 500 }}>API Provider</span>
				</label>
				<VSCodeDropdown
					id="api-provider"
					value={selectedProvider}
					onChange={handleInputChange("apiProvider")}
					style={{ minWidth: 130 }}>
					<VSCodeOption value="anthropic">Anthropic</VSCodeOption>
					<VSCodeOption value="openai-native">OpenAI</VSCodeOption>
					<VSCodeOption value="openrouter">OpenRouter</VSCodeOption>
					<VSCodeOption value="gemini">Google Gemini</VSCodeOption>
					<VSCodeOption value="bedrock">AWS Bedrock</VSCodeOption>
					<VSCodeOption value="vertex">GCP Vertex AI</VSCodeOption>
					<VSCodeOption value="openai">OpenAI Compatible</VSCodeOption>
					<VSCodeOption value="ollama">Ollama</VSCodeOption>
				</VSCodeDropdown>
			</div>

			{selectedProvider === "anthropic" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("apiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Anthropic API Key</span>
					</VSCodeTextField>

					<div style={{ marginTop: 2 }}>
						<VSCodeCheckbox
							checked={anthropicBaseUrlSelected}
							onChange={(e: any) => {
								const isChecked = e.target.checked === true
								setAnthropicBaseUrlSelected(isChecked)
								if (!isChecked) {
									setApiConfiguration({ ...apiConfiguration, anthropicBaseUrl: "" })
								}
							}}>
							Use custom base URL
						</VSCodeCheckbox>
					</div>

					{anthropicBaseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.anthropicBaseUrl || ""}
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
						{!apiConfiguration?.apiKey && (
							<VSCodeLink
								href="https://console.anthropic.com/"
								style={{ display: "inline", fontSize: "inherit" }}>
								You can get an Anthropic API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "openai-native" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openAiNativeApiKey || ""}
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
						{!apiConfiguration?.openAiNativeApiKey && (
							<VSCodeLink
								href="https://platform.openai.com/api-keys"
								style={{ display: "inline", fontSize: "inherit" }}>
								You can get an OpenAI API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "openrouter" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openRouterApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("openRouterApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>OpenRouter API Key</span>
					</VSCodeTextField>
					{!apiConfiguration?.openRouterApiKey && (
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
						{/* {!apiConfiguration?.openRouterApiKey && (
							<span style={{ color: "var(--vscode-charts-green)" }}>
								(<span style={{ fontWeight: 500 }}>Note:</span> OpenRouter is recommended for high rate
								limits, prompt caching, and wider selection of models.)
							</span>
						)} */}
					</p>
				</div>
			)}

			{selectedProvider === "bedrock" && (
				<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
					<VSCodeTextField
						value={apiConfiguration?.awsAccessKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsAccessKey")}
						placeholder="Enter Access Key...">
						<span style={{ fontWeight: 500 }}>AWS Access Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSecretKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsSecretKey")}
						placeholder="Enter Secret Key...">
						<span style={{ fontWeight: 500 }}>AWS Secret Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSessionToken || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsSessionToken")}
						placeholder="Enter Session Token...">
						<span style={{ fontWeight: 500 }}>AWS Session Token</span>
					</VSCodeTextField>
					<div className="dropdown-container">
						<label htmlFor="aws-region-dropdown">
							<span style={{ fontWeight: 500 }}>AWS Region</span>
						</label>
						<VSCodeDropdown
							id="aws-region-dropdown"
							value={apiConfiguration?.awsRegion || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("awsRegion")}>
							<VSCodeOption value="">Select a region...</VSCodeOption>
							{/* The user will have to choose a region that supports the model they use, but this shouldn't be a problem since they'd have to request access for it in that region in the first place. */}
							<VSCodeOption value="us-east-1">us-east-1</VSCodeOption>
							{/* <VSCodeOption value="us-east-2">us-east-2</VSCodeOption> */}
							{/* <VSCodeOption value="us-west-1">us-west-1</VSCodeOption> */}
							<VSCodeOption value="us-west-2">us-west-2</VSCodeOption>
							{/* <VSCodeOption value="af-south-1">af-south-1</VSCodeOption> */}
							{/* <VSCodeOption value="ap-east-1">ap-east-1</VSCodeOption> */}
							<VSCodeOption value="ap-south-1">ap-south-1</VSCodeOption>
							<VSCodeOption value="ap-northeast-1">ap-northeast-1</VSCodeOption>
							{/* <VSCodeOption value="ap-northeast-2">ap-northeast-2</VSCodeOption> */}
							{/* <VSCodeOption value="ap-northeast-3">ap-northeast-3</VSCodeOption> */}
							<VSCodeOption value="ap-southeast-1">ap-southeast-1</VSCodeOption>
							<VSCodeOption value="ap-southeast-2">ap-southeast-2</VSCodeOption>
							<VSCodeOption value="ca-central-1">ca-central-1</VSCodeOption>
							<VSCodeOption value="eu-central-1">eu-central-1</VSCodeOption>
							<VSCodeOption value="eu-west-1">eu-west-1</VSCodeOption>
							<VSCodeOption value="eu-west-2">eu-west-2</VSCodeOption>
							<VSCodeOption value="eu-west-3">eu-west-3</VSCodeOption>
							{/* <VSCodeOption value="eu-north-1">eu-north-1</VSCodeOption> */}
							{/* <VSCodeOption value="me-south-1">me-south-1</VSCodeOption> */}
							<VSCodeOption value="sa-east-1">sa-east-1</VSCodeOption>
						</VSCodeDropdown>
					</div>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Authenticate by either providing the keys above or use the default AWS credential providers,
						i.e. ~/.aws/credentials or environment variables. These credentials are only used locally to
						make API requests from this extension.
					</p>
				</div>
			)}

			{apiConfiguration?.apiProvider === "vertex" && (
				<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
					<VSCodeTextField
						value={apiConfiguration?.vertexProjectId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("vertexProjectId")}
						placeholder="Enter Project ID...">
						<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
					</VSCodeTextField>
					<div className="dropdown-container">
						<label htmlFor="vertex-region-dropdown">
							<span style={{ fontWeight: 500 }}>Google Cloud Region</span>
						</label>
						<VSCodeDropdown
							id="vertex-region-dropdown"
							value={apiConfiguration?.vertexRegion || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("vertexRegion")}>
							<VSCodeOption value="">Select a region...</VSCodeOption>
							<VSCodeOption value="us-east5">us-east5</VSCodeOption>
							<VSCodeOption value="us-central1">us-central1</VSCodeOption>
							<VSCodeOption value="europe-west1">europe-west1</VSCodeOption>
							<VSCodeOption value="europe-west4">europe-west4</VSCodeOption>
							<VSCodeOption value="asia-southeast1">asia-southeast1</VSCodeOption>
						</VSCodeDropdown>
					</div>
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
							{
								"1) create a Google Cloud account › enable the Vertex AI API › enable the desired Claude models,"
							}
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
						value={apiConfiguration?.geminiApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("geminiApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Gemini API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.geminiApiKey && (
							<VSCodeLink
								href="https://ai.google.dev/"
								style={{ display: "inline", fontSize: "inherit" }}>
								You can get a Gemini API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "openai" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openAiBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("openAiBaseUrl")}
						placeholder={"Enter base URL..."}>
						<span style={{ fontWeight: 500 }}>Base URL</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openAiApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("openAiApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>API Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openAiModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("openAiModelId")}
						placeholder={"Enter Model ID..."}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						You can use any OpenAI compatible API with models that support tool use.{" "}
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Claude Dev uses complex prompts and works
							best with Claude models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "ollama" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.ollamaBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("ollamaBaseUrl")}
						placeholder={"Default: http://localhost:11434"}>
						<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.ollamaModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("ollamaModelId")}
						placeholder={"e.g. llama3.1"}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>
					{ollamaModels.length > 0 && (
						<VSCodeRadioGroup
							value={
								ollamaModels.includes(apiConfiguration?.ollamaModelId || "")
									? apiConfiguration?.ollamaModelId
									: ""
							}
							onChange={(e) => {
								const value = (e.target as HTMLInputElement)?.value
								// need to check value first since radio group returns empty string sometimes
								if (value) {
									handleInputChange("ollamaModelId")({
										target: { value },
									})
								}
							}}>
							{ollamaModels.map((model) => (
								<VSCodeRadio
									key={model}
									value={model}
									checked={apiConfiguration?.ollamaModelId === model}>
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
						Ollama allows you to run models locally on your computer. For instructions on how to get
						started, see their
						<VSCodeLink
							href="https://github.com/ollama/ollama/blob/main/README.md"
							style={{ display: "inline", fontSize: "inherit" }}>
							quickstart guide.
						</VSCodeLink>{" "}
						You can use any model that supports{" "}
						<VSCodeLink
							href="https://ollama.com/search?c=tools"
							style={{ display: "inline", fontSize: "inherit" }}>
							tool use.
						</VSCodeLink>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span style={{ fontWeight: 500 }}>Note:</span> Claude Dev uses complex prompts and works
							best with Claude models. Less capable models may not work as expected.)
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

			{selectedProvider !== "openai" && selectedProvider !== "ollama" && showModelOptions && (
				<>
					<div className="dropdown-container">
						<label htmlFor="model-id">
							<span style={{ fontWeight: 500 }}>Model</span>
						</label>
						{selectedProvider === "anthropic" && createDropdown(anthropicModels)}
						{selectedProvider === "openrouter" && createDropdown(openRouterModels)}
						{selectedProvider === "bedrock" && createDropdown(bedrockModels)}
						{selectedProvider === "vertex" && createDropdown(vertexModels)}
						{selectedProvider === "gemini" && createDropdown(geminiModels)}
						{selectedProvider === "openai-native" && createDropdown(openAiNativeModels)}
					</div>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} />
				</>
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

const ModelInfoView = ({ selectedModelId, modelInfo }: { selectedModelId: string; modelInfo: ModelInfo }) => {
	const isGemini = Object.keys(geminiModels).includes(selectedModelId)
	const isO1 = (["o1-preview", "o1-mini"] as OpenAiNativeModelId[]).includes(selectedModelId as OpenAiNativeModelId)
	return (
		<p style={{ fontSize: "12px", marginTop: "2px", color: "var(--vscode-descriptionForeground)" }}>
			<ModelInfoSupportsItem
				isSupported={modelInfo.supportsImages}
				supportsLabel="Supports images"
				doesNotSupportLabel="Does not support images"
			/>
			<br />
			{!isGemini && (
				<>
					<ModelInfoSupportsItem
						isSupported={modelInfo.supportsPromptCache}
						supportsLabel="Supports prompt caching"
						doesNotSupportLabel="Does not support prompt caching"
					/>
					<br />
				</>
			)}
			<span style={{ fontWeight: 500 }}>Max output:</span> {modelInfo?.maxTokens?.toLocaleString()} tokens
			{modelInfo.inputPrice > 0 && (
				<>
					<br />
					<span style={{ fontWeight: 500 }}>Input price:</span> {formatPrice(modelInfo.inputPrice)}/million
					tokens
				</>
			)}
			{modelInfo.supportsPromptCache && modelInfo.cacheWritesPrice && modelInfo.cacheReadsPrice && (
				<>
					<br />
					<span style={{ fontWeight: 500 }}>Cache writes price:</span>{" "}
					{formatPrice(modelInfo.cacheWritesPrice || 0)}/million tokens
					<br />
					<span style={{ fontWeight: 500 }}>Cache reads price:</span>{" "}
					{formatPrice(modelInfo.cacheReadsPrice || 0)}/million tokens
				</>
			)}
			{modelInfo.outputPrice > 0 && (
				<>
					<br />
					<span style={{ fontWeight: 500 }}>Output price:</span> {formatPrice(modelInfo.outputPrice)}/million
					tokens
				</>
			)}
			{isGemini && (
				<>
					<br />
					<span
						style={{
							fontStyle: "italic",
						}}>
						* Free up to {selectedModelId === geminiDefaultModelId ? "15" : "2"} requests per minute. After
						that, billing depends on prompt size.{" "}
						<VSCodeLink
							href="https://ai.google.dev/pricing"
							style={{ display: "inline", fontSize: "inherit" }}>
							For more info, see pricing details.
						</VSCodeLink>
					</span>
				</>
			)}
			{isO1 && (
				<>
					<br />
					<span
						style={{
							fontStyle: "italic",
						}}>
						* This model is newly released and may not be accessible to all users yet.
					</span>
				</>
			)}
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

export function normalizeApiConfiguration(apiConfiguration?: ApiConfiguration) {
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
		return { selectedProvider: provider, selectedModelId, selectedModelInfo }
	}
	switch (provider) {
		case "anthropic":
			return getProviderData(anthropicModels, anthropicDefaultModelId)
		case "openrouter":
			return getProviderData(openRouterModels, openRouterDefaultModelId)
		case "bedrock":
			return getProviderData(bedrockModels, bedrockDefaultModelId)
		case "vertex":
			return getProviderData(vertexModels, vertexDefaultModelId)
		case "gemini":
			return getProviderData(geminiModels, geminiDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "openai":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openAiModelId ?? "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "ollama":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.ollamaModelId ?? "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

export default memo(ApiOptions)
