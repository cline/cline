import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useDebounce, useEvent } from "react-use"
import { Checkbox, Dropdown, type DropdownOption } from "vscrui"
import { VSCodeLink, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import * as vscodemodels from "vscode"

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Button } from "@/components/ui"

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
import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { ModelInfoView } from "./ModelInfoView"
import { ModelPicker } from "./ModelPicker"
import { TemperatureControl } from "./TemperatureControl"
import { validateApiConfiguration, validateModelId, validateBedrockArn } from "@/utils/validate"
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

const providers = [
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
	{ value: "human-relay", label: "Human Relay" },
]

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
	const [googleGeminiBaseUrlSelected, setGoogleGeminiBaseUrlSelected] = useState(
		!!apiConfiguration?.googleGeminiBaseUrl,
	)
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
		<div className="flex flex-col gap-3">
			<div className="dropdown-container">
				<label htmlFor="api-provider" className="font-medium">
					API Provider
				</label>
				<Select
					value={selectedProvider}
					onValueChange={handleInputChange("apiProvider", dropdownEventTransform)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Select" />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{providers.map(({ value, label }) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</div>

			{errorMessage && <ApiErrorMessage errorMessage={errorMessage} />}

			{selectedProvider === "openrouter" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.openRouterApiKey || ""}
						type="password"
						onInput={handleInputChange("openRouterApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">OpenRouter API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.openRouterApiKey && (
						<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} appearance="secondary">
							Get OpenRouter API Key
						</VSCodeButtonLink>
					)}
					{!fromWelcomeView && (
						<>
							<div>
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
										type="url"
										onInput={handleInputChange("openRouterBaseUrl")}
										placeholder="Default: https://openrouter.ai/api/v1"
										className="w-full mt-1"
									/>
								)}
							</div>
							<Checkbox
								checked={apiConfiguration?.openRouterUseMiddleOutTransform ?? true}
								onChange={handleInputChange("openRouterUseMiddleOutTransform", noTransform)}>
								Compress prompts and message chains to the context size (
								<a href="https://openrouter.ai/docs/transforms">OpenRouter Transforms</a>)
							</Checkbox>
						</>
					)}
				</>
			)}

			{selectedProvider === "anthropic" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.apiKey || ""}
						type="password"
						onInput={handleInputChange("apiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<div className="font-medium">Anthropic API Key</div>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.apiKey && (
						<VSCodeButtonLink href="https://console.anthropic.com/settings/keys" appearance="secondary">
							Get Anthropic API Key
						</VSCodeButtonLink>
					)}
					<div>
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
								type="url"
								onInput={handleInputChange("anthropicBaseUrl")}
								placeholder="https://api.anthropic.com"
								className="w-full mt-1"
							/>
						)}
					</div>
				</>
			)}

			{selectedProvider === "glama" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.glamaApiKey || ""}
						type="password"
						onInput={handleInputChange("glamaApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">Glama API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.glamaApiKey && (
						<VSCodeButtonLink href={getGlamaAuthUrl(uriScheme)} appearance="secondary">
							Get Glama API Key
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "requesty" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.requestyApiKey || ""}
						type="password"
						onInput={handleInputChange("requestyApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">Requesty API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
				</>
			)}

			{selectedProvider === "openai-native" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.openAiNativeApiKey || ""}
						type="password"
						onInput={handleInputChange("openAiNativeApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">OpenAI API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.openAiNativeApiKey && (
						<VSCodeButtonLink href="https://platform.openai.com/api-keys" appearance="secondary">
							Get OpenAI API Key
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "mistral" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.mistralApiKey || ""}
						type="password"
						onInput={handleInputChange("mistralApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">Mistral API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.mistralApiKey && (
						<VSCodeButtonLink href="https://console.mistral.ai/" appearance="secondary">
							Get Mistral / Codestral API Key
						</VSCodeButtonLink>
					)}
					{(apiConfiguration?.apiModelId?.startsWith("codestral-") ||
						(!apiConfiguration?.apiModelId && mistralDefaultModelId.startsWith("codestral-"))) && (
						<>
							<VSCodeTextField
								value={apiConfiguration?.mistralCodestralUrl || ""}
								type="url"
								onInput={handleInputChange("mistralCodestralUrl")}
								placeholder="https://codestral.mistral.ai"
								className="w-full">
								<span className="font-medium">Codestral Base URL (Optional)</span>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground -mt-2">
								Set an alternative URL for the Codestral model.
							</div>
						</>
					)}
				</>
			)}

			{selectedProvider === "bedrock" && (
				<>
					<VSCodeRadioGroup
						value={apiConfiguration?.awsUseProfile ? "profile" : "credentials"}
						onChange={handleInputChange(
							"awsUseProfile",
							(e) => (e.target as HTMLInputElement).value === "profile",
						)}>
						<VSCodeRadio value="credentials">AWS Credentials</VSCodeRadio>
						<VSCodeRadio value="profile">AWS Profile</VSCodeRadio>
					</VSCodeRadioGroup>
					<div className="text-sm text-vscode-descriptionForeground -mt-3">
						Authenticate by providing an access key and secret or use the default AWS credential providers,
						i.e. ~/.aws/credentials or environment variables. These credentials are only used locally to
						make API requests from this extension.
					</div>
					{apiConfiguration?.awsUseProfile ? (
						<VSCodeTextField
							value={apiConfiguration?.awsProfile || ""}
							onInput={handleInputChange("awsProfile")}
							placeholder="Enter profile name"
							className="w-full">
							<span className="font-medium">AWS Profile Name</span>
						</VSCodeTextField>
					) : (
						<>
							<VSCodeTextField
								value={apiConfiguration?.awsAccessKey || ""}
								type="password"
								onInput={handleInputChange("awsAccessKey")}
								placeholder="Enter Access Key..."
								className="w-full">
								<span className="font-medium">AWS Access Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSecretKey || ""}
								type="password"
								onInput={handleInputChange("awsSecretKey")}
								placeholder="Enter Secret Key..."
								className="w-full">
								<span className="font-medium">AWS Secret Key</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSessionToken || ""}
								type="password"
								onInput={handleInputChange("awsSessionToken")}
								placeholder="Enter Session Token..."
								className="w-full">
								<span className="font-medium">AWS Session Token</span>
							</VSCodeTextField>
						</>
					)}
					<div className="dropdown-container">
						<label htmlFor="aws-region-dropdown" className="font-medium">
							AWS Region
						</label>
						<Dropdown
							id="aws-region-dropdown"
							value={apiConfiguration?.awsRegion || ""}
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
							className="w-full"
						/>
					</div>
					<Checkbox
						checked={apiConfiguration?.awsUseCrossRegionInference || false}
						onChange={handleInputChange("awsUseCrossRegionInference", noTransform)}>
						Use cross-region inference
					</Checkbox>
				</>
			)}

			{selectedProvider === "vertex" && (
				<>
					<div className="text-sm text-vscode-descriptionForeground">
						<div>To use Google Cloud Vertex AI, you need to:</div>
						<div>
							<VSCodeLink
								href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
								className="text-sm">
								1. Create a Google Cloud account, enable the Vertex AI API & enable the desired Claude
								models.
							</VSCodeLink>
						</div>
						<div>
							<VSCodeLink
								href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
								className="text-sm">
								2. Install the Google Cloud CLI & configure application default credentials.
							</VSCodeLink>
						</div>
						<div>
							<VSCodeLink
								href="https://developers.google.com/workspace/guides/create-credentials?hl=en#service-account"
								className="text-sm">
								3. Or create a service account with credentials.
							</VSCodeLink>
						</div>
					</div>
					<VSCodeTextField
						value={apiConfiguration?.vertexJsonCredentials || ""}
						onInput={handleInputChange("vertexJsonCredentials")}
						placeholder="Enter Credentials JSON..."
						className="w-full">
						<span className="font-medium">Google Cloud Credentials</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.vertexKeyFile || ""}
						onInput={handleInputChange("vertexKeyFile")}
						placeholder="Enter Key File Path..."
						className="w-full">
						<span className="font-medium">Google Cloud Key File Path</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.vertexProjectId || ""}
						onInput={handleInputChange("vertexProjectId")}
						placeholder="Enter Project ID..."
						className="w-full">
						<span className="font-medium">Google Cloud Project ID</span>
					</VSCodeTextField>
					<div className="dropdown-container">
						<label htmlFor="vertex-region-dropdown" className="font-medium">
							Google Cloud Region
						</label>
						<Dropdown
							id="vertex-region-dropdown"
							value={apiConfiguration?.vertexRegion || ""}
							onChange={handleInputChange("vertexRegion", dropdownEventTransform)}
							options={[
								{ value: "", label: "Select a region..." },
								{ value: "us-east5", label: "us-east5" },
								{ value: "us-central1", label: "us-central1" },
								{ value: "europe-west1", label: "europe-west1" },
								{ value: "europe-west4", label: "europe-west4" },
								{ value: "asia-southeast1", label: "asia-southeast1" },
							]}
							className="w-full"
						/>
					</div>
				</>
			)}

			{selectedProvider === "gemini" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.geminiApiKey || ""}
						type="password"
						onInput={handleInputChange("geminiApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">Gemini API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.geminiApiKey && (
						<VSCodeButtonLink href="https://ai.google.dev/" appearance="secondary">
							Get Gemini API Key
						</VSCodeButtonLink>
					)}
					<div>
						<Checkbox
							checked={googleGeminiBaseUrlSelected}
							onChange={(checked: boolean) => {
								setGoogleGeminiBaseUrlSelected(checked)

								if (!checked) {
									setApiConfigurationField("googleGeminiBaseUrl", "")
								}
							}}>
							Use custom base URL
						</Checkbox>
						{googleGeminiBaseUrlSelected && (
							<VSCodeTextField
								value={apiConfiguration?.googleGeminiBaseUrl || ""}
								type="url"
								onInput={handleInputChange("googleGeminiBaseUrl")}
								placeholder="https://generativelanguage.googleapis.com"
								className="w-full mt-1"
							/>
						)}
					</div>
				</>
			)}

			{selectedProvider === "openai" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.openAiBaseUrl || ""}
						type="url"
						onInput={handleInputChange("openAiBaseUrl")}
						placeholder={"Enter base URL..."}
						className="w-full">
						<span className="font-medium">Base URL</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openAiApiKey || ""}
						type="password"
						onInput={handleInputChange("openAiApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
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
					<Checkbox
						checked={apiConfiguration?.openAiStreamingEnabled ?? true}
						onChange={handleInputChange("openAiStreamingEnabled", noTransform)}>
						Enable streaming
					</Checkbox>
					<Checkbox
						checked={apiConfiguration?.openAiUseAzure ?? false}
						onChange={handleInputChange("openAiUseAzure", noTransform)}>
						Use Azure
					</Checkbox>
					<div>
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
								onInput={handleInputChange("azureApiVersion")}
								placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
								className="w-full mt-1"
							/>
						)}
					</div>

					<div className="flex flex-col gap-3">
						<div className="text-sm text-vscode-descriptionForeground">
							Configure the capabilities and pricing for your custom OpenAI-compatible model. Be careful
							when specifying the model capabilities, as they can affect how Roo Code performs.
						</div>

						<div>
							<VSCodeTextField
								value={
									apiConfiguration?.openAiCustomModelInfo?.maxTokens?.toString() ||
									openAiModelInfoSaneDefaults.maxTokens?.toString() ||
									""
								}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.maxTokens

										if (!value) {
											return "var(--vscode-input-border)"
										}

										return value > 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								title="Maximum number of tokens the model can generate in a single response"
								onInput={handleInputChange("openAiCustomModelInfo", (e) => {
									const value = parseInt((e.target as HTMLInputElement).value)

									return {
										...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
										maxTokens: isNaN(value) ? undefined : value,
									}
								})}
								placeholder="e.g. 4096"
								className="w-full">
								<span className="font-medium">Max Output Tokens</span>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground">
								Maximum number of tokens the model can generate in a response. (Specify -1 to allow the
								server to set the max tokens.)
							</div>
						</div>

						<div>
							<VSCodeTextField
								value={
									apiConfiguration?.openAiCustomModelInfo?.contextWindow?.toString() ||
									openAiModelInfoSaneDefaults.contextWindow?.toString() ||
									""
								}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.contextWindow

										if (!value) {
											return "var(--vscode-input-border)"
										}

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
										...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
										contextWindow: isNaN(parsed)
											? openAiModelInfoSaneDefaults.contextWindow
											: parsed,
									}
								})}
								placeholder="e.g. 128000"
								className="w-full">
								<span className="font-medium">Context Window Size</span>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground">
								Total tokens (input + output) the model can process.
							</div>
						</div>

						<div>
							<div className="flex items-center gap-1">
								<Checkbox
									checked={
										apiConfiguration?.openAiCustomModelInfo?.supportsImages ??
										openAiModelInfoSaneDefaults.supportsImages
									}
									onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
										return {
											...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
											supportsImages: checked,
										}
									})}>
									<span className="font-medium">Image Support</span>
								</Checkbox>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									title="Enable if the model can process and understand images in the input. Required for image-based assistance and visual code understanding."
									style={{ fontSize: "12px" }}
								/>
							</div>
							<div className="text-sm text-vscode-descriptionForeground pt-1">
								Is this model capable of processing and understanding images?
							</div>
						</div>

						<div>
							<div className="flex items-center gap-1">
								<Checkbox
									checked={apiConfiguration?.openAiCustomModelInfo?.supportsComputerUse ?? false}
									onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
										return {
											...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
											supportsComputerUse: checked,
										}
									})}>
									<span className="font-medium">Computer Use</span>
								</Checkbox>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									title="Enable if the model can interact with your computer through commands and file operations. Required for automated tasks and file modifications."
									style={{ fontSize: "12px" }}
								/>
							</div>
							<div className="text-sm text-vscode-descriptionForeground pt-1">
								Is this model capable of interacting with a browser? (e.g. Claude 3.7 Sonnet).
							</div>
						</div>

						<div>
							<div className="flex items-center gap-1">
								<Checkbox
									checked={apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache ?? false}
									onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
										return {
											...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
											supportsPromptCache: checked,
										}
									})}>
									<span className="font-medium">Prompt Caching</span>
								</Checkbox>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									title="Enable if the model supports prompt caching. This can improve performance and reduce costs."
									style={{ fontSize: "12px" }}
								/>
							</div>
							<div className="text-sm text-vscode-descriptionForeground pt-1">
								Is this model capable of caching prompts?
							</div>
						</div>

						<div>
							<VSCodeTextField
								value={
									apiConfiguration?.openAiCustomModelInfo?.inputPrice?.toString() ??
									openAiModelInfoSaneDefaults.inputPrice?.toString() ??
									""
								}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.inputPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChange("openAiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									return {
										...(apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
										inputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.inputPrice : parsed,
									}
								})}
								placeholder="e.g. 0.0001"
								className="w-full">
								<div className="flex items-center gap-1">
									<span className="font-medium">Input Price</span>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										title="Cost per million tokens in the input/prompt. This affects the cost of sending context and instructions to the model."
										style={{ fontSize: "12px" }}
									/>
								</div>
							</VSCodeTextField>
						</div>

						<div>
							<VSCodeTextField
								value={
									apiConfiguration?.openAiCustomModelInfo?.outputPrice?.toString() ||
									openAiModelInfoSaneDefaults.outputPrice?.toString() ||
									""
								}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.outputPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChange("openAiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									return {
										...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
										outputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.outputPrice : parsed,
									}
								})}
								placeholder="e.g. 0.0002"
								className="w-full">
								<div className="flex items-center gap-1">
									<span className="font-medium">Output Price</span>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										title="Cost per million tokens in the model's response. This affects the cost of generated content and completions."
										style={{ fontSize: "12px" }}
									/>
								</div>
							</VSCodeTextField>
						</div>

						{apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache && (
							<>
								<div>
									<VSCodeTextField
										value={
											apiConfiguration?.openAiCustomModelInfo?.cacheReadsPrice?.toString() ?? "0"
										}
										type="text"
										style={{
											borderColor: (() => {
												const value = apiConfiguration?.openAiCustomModelInfo?.cacheReadsPrice

												if (!value && value !== 0) {
													return "var(--vscode-input-border)"
												}

												return value >= 0
													? "var(--vscode-charts-green)"
													: "var(--vscode-errorForeground)"
											})(),
										}}
										onChange={handleInputChange("openAiCustomModelInfo", (e) => {
											const value = (e.target as HTMLInputElement).value
											const parsed = parseFloat(value)

											return {
												...(apiConfiguration?.openAiCustomModelInfo ??
													openAiModelInfoSaneDefaults),
												cacheReadsPrice: isNaN(parsed) ? 0 : parsed,
											}
										})}
										placeholder="e.g. 0.0001"
										className="w-full">
										<div className="flex items-center gap-1">
											<span className="font-medium">Cache Reads Price</span>
											<i
												className="codicon codicon-info text-vscode-descriptionForeground"
												title="Cost per million tokens for reading from the cache. This is the price charged when a cached response is retrieved."
												style={{ fontSize: "12px" }}
											/>
										</div>
									</VSCodeTextField>
								</div>
								<div>
									<VSCodeTextField
										value={
											apiConfiguration?.openAiCustomModelInfo?.cacheWritesPrice?.toString() ?? "0"
										}
										type="text"
										style={{
											borderColor: (() => {
												const value = apiConfiguration?.openAiCustomModelInfo?.cacheWritesPrice

												if (!value && value !== 0) {
													return "var(--vscode-input-border)"
												}

												return value >= 0
													? "var(--vscode-charts-green)"
													: "var(--vscode-errorForeground)"
											})(),
										}}
										onChange={handleInputChange("openAiCustomModelInfo", (e) => {
											const value = (e.target as HTMLInputElement).value
											const parsed = parseFloat(value)

											return {
												...(apiConfiguration?.openAiCustomModelInfo ??
													openAiModelInfoSaneDefaults),
												cacheWritesPrice: isNaN(parsed) ? 0 : parsed,
											}
										})}
										placeholder="e.g. 0.00005"
										className="w-full">
										<div className="flex items-center gap-1">
											<span className="font-medium">Cache Writes Price</span>
											<i
												className="codicon codicon-info text-vscode-descriptionForeground"
												title="Cost per million tokens for writing to the cache. This is the price charged when a prompt is cached for the first time."
												style={{ fontSize: "12px" }}
											/>
										</div>
									</VSCodeTextField>
								</div>
							</>
						)}

						<Button
							variant="secondary"
							onClick={() =>
								setApiConfigurationField("openAiCustomModelInfo", openAiModelInfoSaneDefaults)
							}>
							Reset to Defaults
						</Button>
					</div>
				</>
			)}

			{selectedProvider === "lmstudio" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.lmStudioBaseUrl || ""}
						type="url"
						onInput={handleInputChange("lmStudioBaseUrl")}
						placeholder={"Default: http://localhost:1234"}
						className="w-full">
						<span className="font-medium">Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.lmStudioModelId || ""}
						onInput={handleInputChange("lmStudioModelId")}
						placeholder={"e.g. meta-llama-3.1-8b-instruct"}
						className="w-full">
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
					<Checkbox
						checked={apiConfiguration?.lmStudioSpeculativeDecodingEnabled === true}
						onChange={(checked) => {
							// Explicitly set the boolean value using direct method.
							setApiConfigurationField("lmStudioSpeculativeDecodingEnabled", checked)
						}}>
						Enable Speculative Decoding
					</Checkbox>
					{apiConfiguration?.lmStudioSpeculativeDecodingEnabled && (
						<>
							<div>
								<VSCodeTextField
									value={apiConfiguration?.lmStudioDraftModelId || ""}
									onInput={handleInputChange("lmStudioDraftModelId")}
									placeholder={"e.g. lmstudio-community/llama-3.2-1b-instruct"}
									className="w-full">
									<span className="font-medium">Draft Model ID</span>
								</VSCodeTextField>
								<div className="text-sm text-vscode-descriptionForeground">
									Draft model must be from the same model family for speculative decoding to work
									correctly.
								</div>
							</div>
							{lmStudioModels.length > 0 && (
								<>
									<div className="font-medium">Select Draft Model</div>
									<VSCodeRadioGroup
										value={
											lmStudioModels.includes(apiConfiguration?.lmStudioDraftModelId || "")
												? apiConfiguration?.lmStudioDraftModelId
												: ""
										}
										onChange={handleInputChange("lmStudioDraftModelId")}>
										{lmStudioModels.map((model) => (
											<VSCodeRadio key={`draft-${model}`} value={model}>
												{model}
											</VSCodeRadio>
										))}
									</VSCodeRadioGroup>
									{lmStudioModels.length === 0 && (
										<div
											className="text-sm rounded-xs p-2"
											style={{
												backgroundColor: "var(--vscode-inputValidation-infoBackground)",
												border: "1px solid var(--vscode-inputValidation-infoBorder)",
												color: "var(--vscode-inputValidation-infoForeground)",
											}}>
											No draft models found. Please ensure LM Studio is running with Server Mode
											enabled.
										</div>
									)}
								</>
							)}
						</>
					)}
					<div className="text-sm text-vscode-descriptionForeground">
						LM Studio allows you to run models locally on your computer. For instructions on how to get
						started, see their <VSCodeLink href="https://lmstudio.ai/docs">quickstart guide</VSCodeLink>.
						You will also need to start LM Studio's{" "}
						<VSCodeLink href="https://lmstudio.ai/docs/basics/server">local server</VSCodeLink> feature to
						use it with this extension.
						<span className="text-vscode-errorForeground ml-1">
							<span className="font-medium">Note:</span> Roo Code uses complex prompts and works best with
							Claude models. Less capable models may not work as expected.
						</span>
					</div>
				</>
			)}

			{selectedProvider === "deepseek" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.deepSeekApiKey || ""}
						type="password"
						onInput={handleInputChange("deepSeekApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">DeepSeek API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.deepSeekApiKey && (
						<VSCodeButtonLink href="https://platform.deepseek.com/" appearance="secondary">
							Get DeepSeek API Key
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "vscode-lm" && (
				<>
					<div className="dropdown-container">
						<label htmlFor="vscode-lm-model" className="font-medium">
							Language Model
						</label>
						{vsCodeLmModels.length > 0 ? (
							<Select
								value={
									apiConfiguration?.vsCodeLmModelSelector
										? `${apiConfiguration.vsCodeLmModelSelector.vendor ?? ""}/${apiConfiguration.vsCodeLmModelSelector.family ?? ""}`
										: ""
								}
								onValueChange={handleInputChange("vsCodeLmModelSelector", (valueStr) => {
									const [vendor, family] = valueStr.split("/")
									return { vendor, family }
								})}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Select a model..." />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{vsCodeLmModels.map((model) => (
											<SelectItem
												key={`${model.vendor}/${model.family}`}
												value={`${model.vendor}/${model.family}`}>
												{`${model.vendor} - ${model.family}`}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						) : (
							<div className="text-sm text-vscode-descriptionForeground">
								The VS Code Language Model API allows you to run models provided by other VS Code
								extensions (including but not limited to GitHub Copilot). The easiest way to get started
								is to install the Copilot and Copilot Chat extensions from the VS Code Marketplace.
							</div>
						)}
					</div>
					<div className="text-sm text-vscode-errorForeground">
						Note: This is a very experimental integration and provider support will vary. If you get an
						error about a model not being supported, that's an issue on the provider's end.
					</div>
				</>
			)}

			{selectedProvider === "ollama" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.ollamaBaseUrl || ""}
						type="url"
						onInput={handleInputChange("ollamaBaseUrl")}
						placeholder={"Default: http://localhost:11434"}
						className="w-full">
						<span className="font-medium">Base URL (optional)</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.ollamaModelId || ""}
						onInput={handleInputChange("ollamaModelId")}
						placeholder={"e.g. llama3.1"}
						className="w-full">
						<span className="font-medium">Model ID</span>
					</VSCodeTextField>
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
					<div className="text-sm text-vscode-descriptionForeground">
						Ollama allows you to run models locally on your computer. For instructions on how to get
						started, see their
						<VSCodeLink href="https://github.com/ollama/ollama/blob/main/README.md">
							quickstart guide
						</VSCodeLink>
						.
						<span className="text-vscode-errorForeground ml-1">
							<span className="font-medium">Note:</span> Roo Code uses complex prompts and works best with
							Claude models. Less capable models may not work as expected.
						</span>
					</div>
				</>
			)}

			{selectedProvider === "unbound" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.unboundApiKey || ""}
						type="password"
						onInput={handleInputChange("unboundApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">Unbound API Key</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						This key is stored locally and only used to make API requests from this extension.
					</div>
					{!apiConfiguration?.unboundApiKey && (
						<VSCodeButtonLink href="https://gateway.getunbound.ai" appearance="secondary">
							Get Unbound API Key
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "human-relay" && (
				<>
					<div className="text-sm text-vscode-descriptionForeground">
						No API key is required, but the user needs to help copy and paste the information to the web
						chat AI.
					</div>
					<div className="text-sm text-vscode-descriptionForeground">
						During use, a dialog box will pop up and the current message will be copied to the clipboard
						automatically. You need to paste these to web versions of AI (such as ChatGPT or Claude), then
						copy the AI's reply back to the dialog box and click the confirm button.
					</div>
				</>
			)}

			{/* Model Pickers */}

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
							value={selectedModelId === "custom-arn" ? "custom-arn" : selectedModelId}
							onChange={(value) => {
								const modelValue = typeof value == "string" ? value : value?.value
								setApiConfigurationField("apiModelId", modelValue)

								// Clear custom ARN if not using custom ARN option
								if (modelValue !== "custom-arn" && selectedProvider === "bedrock") {
									setApiConfigurationField("awsCustomArn", "")
								}
							}}
							options={[
								...selectedProviderModelOptions,
								...(selectedProvider === "bedrock"
									? [{ value: "custom-arn", label: "Use custom ARN..." }]
									: []),
							]}
							className="w-full"
						/>
					</div>

					{selectedProvider === "bedrock" && selectedModelId === "custom-arn" && (
						<>
							<VSCodeTextField
								value={apiConfiguration?.awsCustomArn || ""}
								onInput={(e) => {
									const value = (e.target as HTMLInputElement).value
									setApiConfigurationField("awsCustomArn", value)
								}}
								placeholder="Enter ARN (e.g. arn:aws:bedrock:us-east-1:123456789012:foundation-model/my-model)"
								className="w-full">
								<span className="font-medium">Custom ARN</span>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground -mt-2">
								Enter a valid AWS Bedrock ARN for the model you want to use. Format examples:
								<ul className="list-disc pl-5 mt-1">
									<li>
										arn:aws:bedrock:us-east-1:123456789012:foundation-model/anthropic.claude-3-sonnet-20240229-v1:0
									</li>
									<li>
										arn:aws:bedrock:us-west-2:123456789012:provisioned-model/my-provisioned-model
									</li>
									<li>
										arn:aws:bedrock:us-east-1:123456789012:default-prompt-router/anthropic.claude:1
									</li>
								</ul>
								Make sure the region in the ARN matches your selected AWS Region above.
							</div>
							{apiConfiguration?.awsCustomArn &&
								(() => {
									const validation = validateBedrockArn(
										apiConfiguration.awsCustomArn,
										apiConfiguration.awsRegion,
									)

									if (!validation.isValid) {
										return (
											<div className="text-sm text-vscode-errorForeground mt-2">
												{validation.errorMessage ||
													"Invalid ARN format. Please check the examples above."}
											</div>
										)
									}

									if (validation.errorMessage) {
										return (
											<div className="text-sm text-vscode-errorForeground mt-2">
												{validation.errorMessage}
											</div>
										)
									}

									return null
								})()}
							=======
						</>
					)}
					<ModelInfoView
						selectedModelId={selectedModelId}
						modelInfo={selectedModelInfo}
						isDescriptionExpanded={isDescriptionExpanded}
						setIsDescriptionExpanded={setIsDescriptionExpanded}
					/>
					<ThinkingBudget
						key={`${selectedProvider}-${selectedModelId}`}
						apiConfiguration={apiConfiguration}
						setApiConfigurationField={setApiConfigurationField}
						modelInfo={selectedModelInfo}
					/>
				</>
			)}

			{!fromWelcomeView && (
				<TemperatureControl
					value={apiConfiguration?.modelTemperature}
					onChange={handleInputChange("modelTemperature", noTransform)}
					maxValue={2}
				/>
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
			// Special case for custom ARN
			if (modelId === "custom-arn") {
				return {
					selectedProvider: provider,
					selectedModelId: "custom-arn",
					selectedModelInfo: {
						maxTokens: 5000,
						contextWindow: 128_000,
						supportsPromptCache: false,
						supportsImages: true,
					},
				}
			}
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
