import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useDebounce, useEvent } from "react-use"
import { Checkbox, Dropdown, Pane, type DropdownOption } from "vscrui"
import { VSCodeLink, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import * as vscodemodels from "vscode"

import {
	ApiConfiguration,
	ModelInfo,
	anthropicDefaultModelId,
	anthropicModels,
	azureOpenAiDefaultApiVersion,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	glamaDefaultModelId,
	glamaDefaultModelInfo,
	mistralDefaultModelId,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	vertexDefaultModelId,
	vertexModels,
	unboundDefaultModelId,
	unboundDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../../src/shared/api"
import { ExtensionMessage } from "../../../../src/shared/ExtensionMessage"

import { vscode } from "../../utils/vscode"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import { ModelInfoView } from "./ModelInfoView"
import { DROPDOWN_Z_INDEX } from "./styles"
import { ModelPicker } from "./ModelPicker"
import { TemperatureControl } from "./TemperatureControl"
import { validateApiConfiguration, validateModelId } from "@/utils/validate"
import { ApiErrorMessage } from "./ApiErrorMessage"
import { ThinkingBudget } from "./ThinkingBudget"

const modelsByProvider: Record<string, Record<string, ModelInfo>> = {
	anthropic: anthropicModels,
	bedrock: bedrockModels,
	vertex: vertexModels,
	gemini: geminiModels,
	"openai-native": openAiNativeModels,
	deepseek: deepSeekModels,
	mistral: mistralModels,
}

interface ApiOptionsProps {
	uriScheme: string | undefined
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => void
	fromWelcomeView?: boolean
	errorMessage: string | undefined
	setErrorMessage: React.Dispatch<React.SetStateAction<string | undefined>>
}

const ApiOptions = ({
	uriScheme,
	apiConfiguration,
	setApiConfigurationField,
	fromWelcomeView,
	errorMessage,
	setErrorMessage,
}: ApiOptionsProps) => {
	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const [lmStudioModels, setLmStudioModels] = useState<string[]>([])
	const [vsCodeLmModels, setVsCodeLmModels] = useState<vscodemodels.LanguageModelChatSelector[]>([])

	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})

	const [glamaModels, setGlamaModels] = useState<Record<string, ModelInfo>>({
		[glamaDefaultModelId]: glamaDefaultModelInfo,
	})

	const [unboundModels, setUnboundModels] = useState<Record<string, ModelInfo>>({
		[unboundDefaultModelId]: unboundDefaultModelInfo,
	})

	const [requestyModels, setRequestyModels] = useState<Record<string, ModelInfo>>({
		[requestyDefaultModelId]: requestyDefaultModelInfo,
	})

	const [openAiModels, setOpenAiModels] = useState<Record<string, ModelInfo> | null>(null)

	const [anthropicBaseUrlSelected, setAnthropicBaseUrlSelected] = useState(!!apiConfiguration?.anthropicBaseUrl)
	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azureApiVersion)
	const [openRouterBaseUrlSelected, setOpenRouterBaseUrlSelected] = useState(!!apiConfiguration?.openRouterBaseUrl)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	const noTransform = <T,>(value: T) => value
	const inputEventTransform = <E,>(event: E) => (event as { target: HTMLInputElement })?.target?.value as any
	const dropdownEventTransform = <T,>(event: DropdownOption | string | undefined) =>
		(typeof event == "string" ? event : event?.value) as T

	const handleInputChange = useCallback(
		<K extends keyof ApiConfiguration, E>(
			field: K,
			transform: (event: E) => ApiConfiguration[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const { selectedProvider, selectedModelId, selectedModelInfo } = useMemo(
		() => normalizeApiConfiguration(apiConfiguration),
		[apiConfiguration],
	)

	// Debounced refresh model updates, only executed 250ms after the user
	// stops typing.
	useDebounce(
		() => {
			if (selectedProvider === "openrouter") {
				vscode.postMessage({ type: "refreshOpenRouterModels" })
			} else if (selectedProvider === "glama") {
				vscode.postMessage({ type: "refreshGlamaModels" })
			} else if (selectedProvider === "unbound") {
				vscode.postMessage({ type: "refreshUnboundModels" })
			} else if (selectedProvider === "requesty") {
				vscode.postMessage({
					type: "refreshRequestyModels",
					values: { apiKey: apiConfiguration?.requestyApiKey },
				})
			} else if (selectedProvider === "openai") {
				vscode.postMessage({
					type: "refreshOpenAiModels",
					values: { baseUrl: apiConfiguration?.openAiBaseUrl, apiKey: apiConfiguration?.openAiApiKey },
				})
			} else if (selectedProvider === "ollama") {
				vscode.postMessage({ type: "requestOllamaModels", text: apiConfiguration?.ollamaBaseUrl })
			} else if (selectedProvider === "lmstudio") {
				vscode.postMessage({ type: "requestLmStudioModels", text: apiConfiguration?.lmStudioBaseUrl })
			} else if (selectedProvider === "vscode-lm") {
				vscode.postMessage({ type: "requestVsCodeLmModels" })
			}
		},
		250,
		[
			selectedProvider,
			apiConfiguration?.requestyApiKey,
			apiConfiguration?.openAiBaseUrl,
			apiConfiguration?.openAiApiKey,
			apiConfiguration?.ollamaBaseUrl,
			apiConfiguration?.lmStudioBaseUrl,
		],
	)

	useEffect(() => {
		const apiValidationResult =
			validateApiConfiguration(apiConfiguration) ||
			validateModelId(apiConfiguration, glamaModels, openRouterModels, unboundModels, requestyModels)

		setErrorMessage(apiValidationResult)
	}, [apiConfiguration, glamaModels, openRouterModels, setErrorMessage, unboundModels, requestyModels])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "openRouterModels": {
				const updatedModels = message.openRouterModels ?? {}
				setOpenRouterModels({ [openRouterDefaultModelId]: openRouterDefaultModelInfo, ...updatedModels })
				break
			}
			case "glamaModels": {
				const updatedModels = message.glamaModels ?? {}
				setGlamaModels({ [glamaDefaultModelId]: glamaDefaultModelInfo, ...updatedModels })
				break
			}
			case "unboundModels": {
				const updatedModels = message.unboundModels ?? {}
				setUnboundModels({ [unboundDefaultModelId]: unboundDefaultModelInfo, ...updatedModels })
				break
			}
			case "requestyModels": {
				const updatedModels = message.requestyModels ?? {}
				setRequestyModels({ [requestyDefaultModelId]: requestyDefaultModelInfo, ...updatedModels })
				break
			}
			case "openAiModels": {
				const updatedModels = message.openAiModels ?? []
				setOpenAiModels(Object.fromEntries(updatedModels.map((item) => [item, openAiModelInfoSaneDefaults])))
				break
			}
			case "ollamaModels":
				{
					const newModels = message.ollamaModels ?? []
					setOllamaModels(newModels)
				}
				break
			case "lmStudioModels":
				{
					const newModels = message.lmStudioModels ?? []
					setLmStudioModels(newModels)
				}
				break
			case "vsCodeLmModels":
				{
					const newModels = message.vsCodeLmModels ?? []
					setVsCodeLmModels(newModels)
				}
				break
		}
	}, [])

	useEvent("message", onMessage)

	const selectedProviderModelOptions: DropdownOption[] = useMemo(
		() =>
			modelsByProvider[selectedProvider]
				? [
						{ value: "", label: "Select a model..." },
						...Object.keys(modelsByProvider[selectedProvider]).map((modelId) => ({
							value: modelId,
							label: modelId,
						})),
					]
				: [],
		[selectedProvider],
	)

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div className="dropdown-container">
				<label htmlFor="api-provider" className="font-medium">
					API Provider
				</label>
				<Dropdown
					id="api-provider"
					value={selectedProvider}
					onChange={handleInputChange("apiProvider", dropdownEventTransform)}
					style={{ minWidth: 130, position: "relative", zIndex: DROPDOWN_Z_INDEX + 1 }}
					options={[
						{ value: "openrouter", label: "OpenRouter" },
						{ value: "anthropic", label: "Anthropic" },
						{ value: "gemini", label: "Google Gemini" },
						{ value: "deepseek", label: "DeepSeek" },
						{ value: "openai-native", label: "OpenAI" },
						{ value: "openai", label: "OpenAI Compatible" },
						{ value: "vertex", label: "GCP Vertex AI" },
						{ value: "bedrock", label: "AWS Bedrock" },
						{ value: "glama", label: "Glama" },
						{ value: "vscode-lm", label: "VS Code LM API" },
						{ value: "mistral", label: "Mistral" },
						{ value: "lmstudio", label: "LM Studio" },
						{ value: "ollama", label: "Ollama" },
						{ value: "unbound", label: "Unbound" },
						{ value: "requesty", label: "Requesty" },
					]}
				/>
			</div>

			{errorMessage && <ApiErrorMessage errorMessage={errorMessage} />}

			{selectedProvider === "anthropic" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.apiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("apiKey")}
						placeholder="Enter API Key...">
						<span className="font-medium">Anthropic API Key</span>
					</VSCodeTextField>

					<Checkbox
						checked={anthropicBaseUrlSelected}
						onChange={(checked: boolean) => {
							setAnthropicBaseUrlSelected(checked)

							if (!checked) {
								setApiConfigurationField("anthropicBaseUrl", "")
							}
						}}>
						Use custom base URL
					</Checkbox>

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
								href="https://console.anthropic.com/settings/keys"
								style={{ display: "inline", fontSize: "inherit" }}>
								You can get an Anthropic API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "glama" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.glamaApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("glamaApiKey")}
						placeholder="Enter API Key...">
						<span className="font-medium">Glama API Key</span>
					</VSCodeTextField>
					{!apiConfiguration?.glamaApiKey && (
						<VSCodeButtonLink
							href={getGlamaAuthUrl(uriScheme)}
							style={{ margin: "5px 0 0 0" }}
							appearance="secondary">
							Get Glama API Key
						</VSCodeButtonLink>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
					</p>
				</div>
			)}

			{selectedProvider === "requesty" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.requestyApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("requestyApiKey")}
						placeholder="Enter API Key...">
						<span className="font-medium">Requesty API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
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
						<span className="font-medium">OpenAI API Key</span>
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

			{selectedProvider === "mistral" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.mistralApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("mistralApiKey")}
						placeholder="Enter API Key...">
						<span className="font-medium">Mistral API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						<VSCodeLink
							href="https://console.mistral.ai/"
							style={{
								display: "inline",
								fontSize: "inherit",
							}}>
							You can get a La Plateforme (api.mistral.ai) or Codestral (codestral.mistral.ai) API key by
							signing up here.
						</VSCodeLink>
					</p>

					{(apiConfiguration?.apiModelId?.startsWith("codestral-") ||
						(!apiConfiguration?.apiModelId && mistralDefaultModelId.startsWith("codestral-"))) && (
						<div>
							<VSCodeTextField
								value={apiConfiguration?.mistralCodestralUrl || ""}
								style={{ width: "100%", marginTop: "10px" }}
								type="url"
								onInput={handleInputChange("mistralCodestralUrl")}
								placeholder="Default: https://codestral.mistral.ai">
								<span className="font-medium">Codestral Base URL (Optional)</span>
							</VSCodeTextField>
							<p
								style={{
									fontSize: "12px",
									marginTop: 3,
									color: "var(--vscode-descriptionForeground)",
								}}>
								Set alternative URL for Codestral model: https://api.mistral.ai
							</p>
						</div>
					)}
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
						<span className="font-medium">OpenRouter API Key</span>
					</VSCodeTextField>
					{!apiConfiguration?.openRouterApiKey && (
						<p>
							<VSCodeButtonLink
								href={getOpenRouterAuthUrl(uriScheme)}
								style={{ margin: "5px 0 0 0" }}
								appearance="secondary">
								Get OpenRouter API Key
							</VSCodeButtonLink>
						</p>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.{" "}
					</p>
					{!fromWelcomeView && (
						<>
							<Checkbox
								checked={openRouterBaseUrlSelected}
								onChange={(checked: boolean) => {
									setOpenRouterBaseUrlSelected(checked)

									if (!checked) {
										setApiConfigurationField("openRouterBaseUrl", "")
									}
								}}>
								Use custom base URL
							</Checkbox>

							{openRouterBaseUrlSelected && (
								<VSCodeTextField
									value={apiConfiguration?.openRouterBaseUrl || ""}
									style={{ width: "100%", marginTop: 3 }}
									type="url"
									onInput={handleInputChange("openRouterBaseUrl")}
									placeholder="Default: https://openrouter.ai/api/v1"
								/>
							)}
							<Checkbox
								checked={apiConfiguration?.openRouterUseMiddleOutTransform || false}
								onChange={handleInputChange("openRouterUseMiddleOutTransform", noTransform)}>
								Compress prompts and message chains to the context size (
								<a href="https://openrouter.ai/docs/transforms">OpenRouter Transforms</a>)
							</Checkbox>
						</>
					)}
				</div>
			)}

			{selectedProvider === "bedrock" && (
				<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
					<VSCodeRadioGroup
						value={apiConfiguration?.awsUseProfile ? "profile" : "credentials"}
						onChange={handleInputChange(
							"awsUseProfile",
							(e) => (e.target as HTMLInputElement).value === "profile",
						)}>
						<VSCodeRadio value="credentials">AWS Credentials</VSCodeRadio>
						<VSCodeRadio value="profile">AWS Profile</VSCodeRadio>
					</VSCodeRadioGroup>
					{/* AWS Profile Config Block */}
					{apiConfiguration?.awsUseProfile ? (
						<VSCodeTextField
							value={apiConfiguration?.awsProfile || ""}
							style={{ width: "100%" }}
							onInput={handleInputChange("awsProfile")}
							placeholder="Enter profile name">
							<span className="font-medium">AWS Profile Name</span>
						</VSCodeTextField>
					) : (
						<>
							{/* AWS Credentials Config Block */}
							<VSCodeTextField
								value={apiConfiguration?.awsAccessKey || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsAccessKey")}
								placeholder="Enter Access Key...">
								<span className="font-medium">AWS Access Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSecretKey || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsSecretKey")}
								placeholder="Enter Secret Key...">
								<span className="font-medium">AWS Secret Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSessionToken || ""}
								style={{ width: "100%" }}
								type="password"
								onInput={handleInputChange("awsSessionToken")}
								placeholder="Enter Session Token...">
								<span className="font-medium">AWS Session Token</span>
							</VSCodeTextField>
						</>
					)}
					<div className="dropdown-container">
						<label htmlFor="aws-region-dropdown">
							<span className="font-medium">AWS Region</span>
						</label>
						<Dropdown
							id="aws-region-dropdown"
							value={apiConfiguration?.awsRegion || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("awsRegion", dropdownEventTransform)}
							options={[
								{ value: "", label: "Select a region..." },
								{ value: "us-east-1", label: "us-east-1" },
								{ value: "us-east-2", label: "us-east-2" },
								{ value: "us-west-2", label: "us-west-2" },
								{ value: "ap-south-1", label: "ap-south-1" },
								{ value: "ap-northeast-1", label: "ap-northeast-1" },
								{ value: "ap-northeast-2", label: "ap-northeast-2" },
								{ value: "ap-southeast-1", label: "ap-southeast-1" },
								{ value: "ap-southeast-2", label: "ap-southeast-2" },
								{ value: "ca-central-1", label: "ca-central-1" },
								{ value: "eu-central-1", label: "eu-central-1" },
								{ value: "eu-west-1", label: "eu-west-1" },
								{ value: "eu-west-2", label: "eu-west-2" },
								{ value: "eu-west-3", label: "eu-west-3" },
								{ value: "sa-east-1", label: "sa-east-1" },
								{ value: "us-gov-west-1", label: "us-gov-west-1" },
							]}
						/>
					</div>
					<Checkbox
						checked={apiConfiguration?.awsUseCrossRegionInference || false}
						onChange={handleInputChange("awsUseCrossRegionInference", noTransform)}>
						Use cross-region inference
					</Checkbox>
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

			{selectedProvider === "vertex" && (
				<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
					<VSCodeTextField
						value={apiConfiguration?.vertexProjectId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("vertexProjectId")}
						placeholder="Enter Project ID...">
						<span className="font-medium">Google Cloud Project ID</span>
					</VSCodeTextField>
					<div className="dropdown-container">
						<label htmlFor="vertex-region-dropdown">
							<span className="font-medium">Google Cloud Region</span>
						</label>
						<Dropdown
							id="vertex-region-dropdown"
							value={apiConfiguration?.vertexRegion || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("vertexRegion", dropdownEventTransform)}
							options={[
								{ value: "", label: "Select a region..." },
								{ value: "us-east5", label: "us-east5" },
								{ value: "us-central1", label: "us-central1" },
								{ value: "europe-west1", label: "europe-west1" },
								{ value: "europe-west4", label: "europe-west4" },
								{ value: "asia-southeast1", label: "asia-southeast1" },
							]}
						/>
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
						<span className="font-medium">Gemini API Key</span>
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
				<div style={{ display: "flex", flexDirection: "column", rowGap: "5px" }}>
					<VSCodeTextField
						value={apiConfiguration?.openAiBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("openAiBaseUrl")}
						placeholder={"Enter base URL..."}>
						<span className="font-medium">Base URL</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openAiApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("openAiApiKey")}
						placeholder="Enter API Key...">
						<span className="font-medium">API Key</span>
					</VSCodeTextField>
					<ModelPicker
						apiConfiguration={apiConfiguration}
						setApiConfigurationField={setApiConfigurationField}
						defaultModelId="gpt-4o"
						defaultModelInfo={openAiModelInfoSaneDefaults}
						models={openAiModels}
						modelIdKey="openAiModelId"
						modelInfoKey="openAiCustomModelInfo"
						serviceName="OpenAI"
						serviceUrl="https://platform.openai.com"
					/>
					<div style={{ display: "flex", alignItems: "center" }}>
						<Checkbox
							checked={apiConfiguration?.openAiStreamingEnabled ?? true}
							onChange={handleInputChange("openAiStreamingEnabled", noTransform)}>
							Enable streaming
						</Checkbox>
					</div>
					<Checkbox
						checked={apiConfiguration?.openAiUseAzure ?? false}
						onChange={handleInputChange("openAiUseAzure", noTransform)}>
						Use Azure
					</Checkbox>
					<Checkbox
						checked={azureApiVersionSelected}
						onChange={(checked: boolean) => {
							setAzureApiVersionSelected(checked)

							if (!checked) {
								setApiConfigurationField("azureApiVersion", "")
							}
						}}>
						Set Azure API version
					</Checkbox>
					{azureApiVersionSelected && (
						<VSCodeTextField
							value={apiConfiguration?.azureApiVersion || ""}
							style={{ width: "100%", marginTop: 3 }}
							onInput={handleInputChange("azureApiVersion")}
							placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
						/>
					)}
					<div className="mt-4" />
					<Pane
						title="Model Configuration"
						open={false}
						actions={[
							{
								iconName: "refresh",
								onClick: () =>
									setApiConfigurationField("openAiCustomModelInfo", openAiModelInfoSaneDefaults),
							},
						]}>
						<div
							style={{
								padding: 12,
							}}>
							<p
								style={{
									fontSize: "12px",
									color: "var(--vscode-descriptionForeground)",
									margin: "0 0 15px 0",
									lineHeight: "1.4",
								}}>
								Configure the capabilities and pricing for your custom OpenAI-compatible model. <br />
								Be careful for the model capabilities, as they can affect how Roo Code can work.
							</p>

							{/* Capabilities Section */}
							<div>
								<h3 className="font-medium text-sm text-vscode-editor-foreground">
									Model Capabilities
								</h3>
								<div className="flex flex-col gap-2">
									<div className="token-config-field">
										<VSCodeTextField
											value={
												apiConfiguration?.openAiCustomModelInfo?.maxTokens?.toString() ||
												openAiModelInfoSaneDefaults.maxTokens?.toString() ||
												""
											}
											type="text"
											style={{
												width: "100%",
												borderColor: (() => {
													const value = apiConfiguration?.openAiCustomModelInfo?.maxTokens
													if (!value) return "var(--vscode-input-border)"
													return value > 0
														? "var(--vscode-charts-green)"
														: "var(--vscode-errorForeground)"
												})(),
											}}
											title="Maximum number of tokens the model can generate in a single response"
											onInput={handleInputChange("openAiCustomModelInfo", (e) => {
												const value = parseInt((e.target as HTMLInputElement).value)
												return {
													...(apiConfiguration?.openAiCustomModelInfo ||
														openAiModelInfoSaneDefaults),
													maxTokens: isNaN(value) ? undefined : value,
												}
											})}
											placeholder="e.g. 4096">
											<span className="font-medium">Max Output Tokens</span>
										</VSCodeTextField>
										<div
											style={{
												fontSize: "11px",
												color: "var(--vscode-descriptionForeground)",
												marginTop: 4,
												display: "flex",
												alignItems: "center",
												gap: 4,
											}}>
											<i className="codicon codicon-info" style={{ fontSize: "12px" }}></i>
											<span>
												Maximum number of tokens the model can generate in a response. <br />
												(-1 is depend on server)
											</span>
										</div>
									</div>

									<div className="token-config-field">
										<VSCodeTextField
											value={
												apiConfiguration?.openAiCustomModelInfo?.contextWindow?.toString() ||
												openAiModelInfoSaneDefaults.contextWindow?.toString() ||
												""
											}
											type="text"
											style={{
												width: "100%",
												borderColor: (() => {
													const value = apiConfiguration?.openAiCustomModelInfo?.contextWindow
													if (!value) return "var(--vscode-input-border)"
													return value > 0
														? "var(--vscode-charts-green)"
														: "var(--vscode-errorForeground)"
												})(),
											}}
											title="Total number of tokens (input + output) the model can process in a single request"
											onInput={handleInputChange("openAiCustomModelInfo", (e) => {
												const value = (e.target as HTMLInputElement).value
												const parsed = parseInt(value)
												return {
													...(apiConfiguration?.openAiCustomModelInfo ||
														openAiModelInfoSaneDefaults),
													contextWindow: isNaN(parsed)
														? openAiModelInfoSaneDefaults.contextWindow
														: parsed,
												}
											})}
											placeholder="e.g. 128000">
											<span className="font-medium">Context Window Size</span>
										</VSCodeTextField>
										<div
											style={{
												fontSize: "11px",
												color: "var(--vscode-descriptionForeground)",
												marginTop: 4,
												display: "flex",
												alignItems: "center",
												gap: 4,
											}}>
											<i className="codicon codicon-info" style={{ fontSize: "12px" }}></i>
											<span>
												Total tokens (input + output) the model can process. This will help Roo
												Code run correctly.
											</span>
										</div>
									</div>
								</div>
							</div>

							<div>
								<h3 className="font-medium text-sm text-vscode-editor-foreground">Model Features</h3>
								<div className="flex flex-col gap-2">
									<div className="feature-toggle">
										<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
											<Checkbox
												checked={
													apiConfiguration?.openAiCustomModelInfo?.supportsImages ??
													openAiModelInfoSaneDefaults.supportsImages
												}
												onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
													return {
														...(apiConfiguration?.openAiCustomModelInfo ||
															openAiModelInfoSaneDefaults),
														supportsImages: checked,
													}
												})}>
												<span className="font-medium">Image Support</span>
											</Checkbox>
											<i
												className="codicon codicon-info"
												title="Enable if the model can process and understand images in the input. Required for image-based assistance and visual code understanding."
												style={{
													fontSize: "12px",
													color: "var(--vscode-descriptionForeground)",
													cursor: "help",
												}}
											/>
										</div>
										<p
											style={{
												fontSize: "11px",
												color: "var(--vscode-descriptionForeground)",
												marginLeft: "24px",
												marginTop: "4px",
												lineHeight: "1.4",
												marginBottom: 0,
											}}>
											Allows the model to analyze and understand images, essential for visual code
											assistance
										</p>
									</div>

									<div
										className="feature-toggle"
										style={{
											borderTop: "1px solid var(--vscode-input-border)",
										}}>
										<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
											<Checkbox
												checked={
													apiConfiguration?.openAiCustomModelInfo?.supportsComputerUse ??
													false
												}
												onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
													return {
														...(apiConfiguration?.openAiCustomModelInfo ||
															openAiModelInfoSaneDefaults),
														supportsComputerUse: checked,
													}
												})}>
												<span className="font-medium">Computer Use</span>
											</Checkbox>
											<i
												className="codicon codicon-info"
												title="Enable if the model can interact with your computer through commands and file operations. Required for automated tasks and file modifications."
												style={{
													fontSize: "12px",
													color: "var(--vscode-descriptionForeground)",
													cursor: "help",
												}}
											/>
										</div>
										<p
											style={{
												fontSize: "11px",
												color: "var(--vscode-descriptionForeground)",
												marginLeft: "24px",
												marginTop: "4px",
												lineHeight: "1.4",
												marginBottom: 0,
											}}>
											This model feature is for computer use like sonnet 3.5 support
										</p>
									</div>
								</div>
							</div>

							{/* Pricing Section */}
							<div>
								<h3 className="font-medium text-sm text-vscode-editor-foreground mb-0">
									Model Pricing
								</h3>
								<div className="text-xs">Configure token-based pricing in USD per million tokens</div>
								<div className="flex flex-row gap-2 mt-1.5">
									<div className="price-input">
										<VSCodeTextField
											value={
												apiConfiguration?.openAiCustomModelInfo?.inputPrice?.toString() ??
												openAiModelInfoSaneDefaults.inputPrice?.toString() ??
												""
											}
											type="text"
											style={{
												width: "100%",
												borderColor: (() => {
													const value = apiConfiguration?.openAiCustomModelInfo?.inputPrice
													if (!value && value !== 0) return "var(--vscode-input-border)"
													return value >= 0
														? "var(--vscode-charts-green)"
														: "var(--vscode-errorForeground)"
												})(),
											}}
											onInput={handleInputChange("openAiCustomModelInfo", (e) => {
												const value = (e.target as HTMLInputElement).value
												const parsed = parseFloat(value)
												return {
													...(apiConfiguration?.openAiCustomModelInfo ??
														openAiModelInfoSaneDefaults),
													inputPrice: isNaN(parsed)
														? openAiModelInfoSaneDefaults.inputPrice
														: parsed,
												}
											})}
											placeholder="e.g. 0.0001">
											<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
												<span className="font-medium">Input Price</span>
												<i
													className="codicon codicon-info"
													title="Cost per million tokens in the input/prompt. This affects the cost of sending context and instructions to the model."
													style={{
														fontSize: "12px",
														color: "var(--vscode-descriptionForeground)",
														cursor: "help",
													}}
												/>
											</div>
										</VSCodeTextField>
									</div>

									<div className="price-input">
										<VSCodeTextField
											value={
												apiConfiguration?.openAiCustomModelInfo?.outputPrice?.toString() ||
												openAiModelInfoSaneDefaults.outputPrice?.toString() ||
												""
											}
											type="text"
											style={{
												width: "100%",
												borderColor: (() => {
													const value = apiConfiguration?.openAiCustomModelInfo?.outputPrice
													if (!value && value !== 0) return "var(--vscode-input-border)"
													return value >= 0
														? "var(--vscode-charts-green)"
														: "var(--vscode-errorForeground)"
												})(),
											}}
											onInput={handleInputChange("openAiCustomModelInfo", (e) => {
												const value = (e.target as HTMLInputElement).value
												const parsed = parseFloat(value)
												return {
													...(apiConfiguration?.openAiCustomModelInfo ||
														openAiModelInfoSaneDefaults),
													outputPrice: isNaN(parsed)
														? openAiModelInfoSaneDefaults.outputPrice
														: parsed,
												}
											})}
											placeholder="e.g. 0.0002">
											<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
												<span className="font-medium">Output Price</span>
												<i
													className="codicon codicon-info"
													title="Cost per million tokens in the model's response. This affects the cost of generated content and completions."
													style={{
														fontSize: "12px",
														color: "var(--vscode-descriptionForeground)",
														cursor: "help",
													}}
												/>
											</div>
										</VSCodeTextField>
									</div>
								</div>
							</div>
						</div>
					</Pane>
					<div
						style={{
							marginTop: 15,
						}}
					/>

					{/* end Model Info Configuration */}
				</div>
			)}

			{selectedProvider === "lmstudio" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.lmStudioBaseUrl || ""}
						style={{ width: "100%" }}
						type="url"
						onInput={handleInputChange("lmStudioBaseUrl")}
						placeholder={"Default: http://localhost:1234"}>
						<span className="font-medium">Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.lmStudioModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("lmStudioModelId")}
						placeholder={"e.g. meta-llama-3.1-8b-instruct"}>
						<span className="font-medium">Model ID</span>
					</VSCodeTextField>
					{lmStudioModels.length > 0 && (
						<VSCodeRadioGroup
							value={
								lmStudioModels.includes(apiConfiguration?.lmStudioModelId || "")
									? apiConfiguration?.lmStudioModelId
									: ""
							}
							onChange={handleInputChange("lmStudioModelId")}>
							{lmStudioModels.map((model) => (
								<VSCodeRadio
									key={model}
									value={model}
									checked={apiConfiguration?.lmStudioModelId === model}>
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
						LM Studio allows you to run models locally on your computer. For instructions on how to get
						started, see their
						<VSCodeLink href="https://lmstudio.ai/docs" style={{ display: "inline", fontSize: "inherit" }}>
							quickstart guide.
						</VSCodeLink>
						You will also need to start LM Studio's{" "}
						<VSCodeLink
							href="https://lmstudio.ai/docs/basics/server"
							style={{ display: "inline", fontSize: "inherit" }}>
							local server
						</VSCodeLink>{" "}
						feature to use it with this extension.{" "}
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span className="font-medium">Note:</span> Roo Code uses complex prompts and works best
							with Claude models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "deepseek" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.deepSeekApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("deepSeekApiKey")}
						placeholder="Enter API Key...">
						<span className="font-medium">DeepSeek API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						{!apiConfiguration?.deepSeekApiKey && (
							<VSCodeLink
								href="https://platform.deepseek.com/"
								style={{ display: "inline", fontSize: "inherit" }}>
								You can get a DeepSeek API key by signing up here.
							</VSCodeLink>
						)}
					</p>
				</div>
			)}

			{selectedProvider === "vscode-lm" && (
				<div>
					<div className="dropdown-container">
						<label htmlFor="vscode-lm-model">
							<span className="font-medium">Language Model</span>
						</label>
						{vsCodeLmModels.length > 0 ? (
							<Dropdown
								id="vscode-lm-model"
								value={
									apiConfiguration?.vsCodeLmModelSelector
										? `${apiConfiguration.vsCodeLmModelSelector.vendor ?? ""}/${apiConfiguration.vsCodeLmModelSelector.family ?? ""}`
										: ""
								}
								onChange={handleInputChange("vsCodeLmModelSelector", (e) => {
									const valueStr = (e as DropdownOption)?.value
									const [vendor, family] = valueStr.split("/")
									return { vendor, family }
								})}
								style={{ width: "100%" }}
								options={[
									{ value: "", label: "Select a model..." },
									...vsCodeLmModels.map((model) => ({
										value: `${model.vendor}/${model.family}`,
										label: `${model.vendor} - ${model.family}`,
									})),
								]}
							/>
						) : (
							<p
								style={{
									fontSize: "12px",
									marginTop: "5px",
									color: "var(--vscode-descriptionForeground)",
								}}>
								The VS Code Language Model API allows you to run models provided by other VS Code
								extensions (including but not limited to GitHub Copilot). The easiest way to get started
								is to install the Copilot and Copilot Chat extensions from the VS Code Marketplace.
							</p>
						)}

						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-errorForeground)",
								fontWeight: 500,
							}}>
							Note: This is a very experimental integration and may not work as expected. Please report
							any issues to the Roo-Code GitHub repository.
						</p>
					</div>
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
						<span className="font-medium">Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.ollamaModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("ollamaModelId")}
						placeholder={"e.g. llama3.1"}>
						<span className="font-medium">Model ID</span>
					</VSCodeTextField>
					{errorMessage && (
						<div className="text-vscode-errorForeground text-sm">
							<span style={{ fontSize: "2em" }} className={`codicon codicon-close align-middle mr-1`} />
							{errorMessage}
						</div>
					)}
					{ollamaModels.length > 0 && (
						<VSCodeRadioGroup
							value={
								ollamaModels.includes(apiConfiguration?.ollamaModelId || "")
									? apiConfiguration?.ollamaModelId
									: ""
							}
							onChange={handleInputChange("ollamaModelId")}>
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
						</VSCodeLink>
						<span style={{ color: "var(--vscode-errorForeground)" }}>
							(<span className="font-medium">Note:</span> Roo Code uses complex prompts and works best
							with Claude models. Less capable models may not work as expected.)
						</span>
					</p>
				</div>
			)}

			{selectedProvider === "unbound" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.unboundApiKey || ""}
						style={{ width: "100%" }}
						type="password"
						onChange={handleInputChange("unboundApiKey")}
						placeholder="Enter API Key...">
						<span className="font-medium">Unbound API Key</span>
					</VSCodeTextField>
					{!apiConfiguration?.unboundApiKey && (
						<VSCodeButtonLink
							href="https://gateway.getunbound.ai"
							style={{ margin: "5px 0 0 0" }}
							appearance="secondary">
							Get Unbound API Key
						</VSCodeButtonLink>
					)}
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
					</p>
				</div>
			)}

			{selectedProvider === "openrouter" && (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId={openRouterDefaultModelId}
					defaultModelInfo={openRouterDefaultModelInfo}
					models={openRouterModels}
					modelIdKey="openRouterModelId"
					modelInfoKey="openRouterModelInfo"
					serviceName="OpenRouter"
					serviceUrl="https://openrouter.ai/models"
				/>
			)}

			{selectedProvider === "glama" && (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId={glamaDefaultModelId}
					defaultModelInfo={glamaDefaultModelInfo}
					models={glamaModels}
					modelInfoKey="glamaModelInfo"
					modelIdKey="glamaModelId"
					serviceName="Glama"
					serviceUrl="https://glama.ai/models"
				/>
			)}

			{selectedProvider === "unbound" && (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					defaultModelId={unboundDefaultModelId}
					defaultModelInfo={unboundDefaultModelInfo}
					models={unboundModels}
					modelInfoKey="unboundModelInfo"
					modelIdKey="unboundModelId"
					serviceName="Unbound"
					serviceUrl="https://api.getunbound.ai/models"
					setApiConfigurationField={setApiConfigurationField}
				/>
			)}

			{selectedProvider === "requesty" && (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId={requestyDefaultModelId}
					defaultModelInfo={requestyDefaultModelInfo}
					models={requestyModels}
					modelIdKey="requestyModelId"
					modelInfoKey="requestyModelInfo"
					serviceName="Requesty"
					serviceUrl="https://requesty.ai"
				/>
			)}

			{selectedProviderModelOptions.length > 0 && (
				<>
					<div className="dropdown-container">
						<label htmlFor="model-id" className="font-medium">
							Model
						</label>
						<Dropdown
							id="model-id"
							value={selectedModelId}
							onChange={(value) => {
								setApiConfigurationField("apiModelId", typeof value == "string" ? value : value?.value)
							}}
							options={selectedProviderModelOptions}
							className="w-full"
						/>
					</div>
					<ThinkingBudget
						apiConfiguration={apiConfiguration}
						setApiConfigurationField={setApiConfigurationField}
						modelInfo={selectedModelInfo}
					/>
					<ModelInfoView
						selectedModelId={selectedModelId}
						modelInfo={selectedModelInfo}
						isDescriptionExpanded={isDescriptionExpanded}
						setIsDescriptionExpanded={setIsDescriptionExpanded}
					/>
				</>
			)}

			{!fromWelcomeView && (
				<div className="mt-2">
					<TemperatureControl
						value={apiConfiguration?.modelTemperature}
						onChange={handleInputChange("modelTemperature", noTransform)}
						maxValue={2}
					/>
				</div>
			)}
		</div>
	)
}

export function getGlamaAuthUrl(uriScheme?: string) {
	const callbackUrl = `${uriScheme || "vscode"}://rooveterinaryinc.roo-cline/glama`

	return `https://glama.ai/oauth/authorize?callback_url=${encodeURIComponent(callbackUrl)}`
}

export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${uriScheme || "vscode"}://rooveterinaryinc.roo-cline/openrouter`
}

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
		case "bedrock":
			return getProviderData(bedrockModels, bedrockDefaultModelId)
		case "vertex":
			return getProviderData(vertexModels, vertexDefaultModelId)
		case "gemini":
			return getProviderData(geminiModels, geminiDefaultModelId)
		case "deepseek":
			return getProviderData(deepSeekModels, deepSeekDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "mistral":
			return getProviderData(mistralModels, mistralDefaultModelId)
		case "openrouter":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "glama":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.glamaModelId || glamaDefaultModelId,
				selectedModelInfo: apiConfiguration?.glamaModelInfo || glamaDefaultModelInfo,
			}
		case "unbound":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.unboundModelId || unboundDefaultModelId,
				selectedModelInfo: apiConfiguration?.unboundModelInfo || unboundDefaultModelInfo,
			}
		case "requesty":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
				selectedModelInfo: apiConfiguration?.requestyModelInfo || requestyDefaultModelInfo,
			}
		case "openai":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openAiModelId || "",
				selectedModelInfo: apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults,
			}
		case "ollama":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.ollamaModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "lmstudio":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.lmStudioModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "vscode-lm":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.vsCodeLmModelSelector
					? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
					: "",
				selectedModelInfo: {
					...openAiModelInfoSaneDefaults,
					supportsImages: false, // VSCode LM API currently doesn't support images.
				},
			}
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

export default memo(ApiOptions)
