import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
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
	const { t } = useAppTranslation()
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
					{t("settings:providers.apiProvider")}
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
						<span className="font-medium">{t("settings:providers.openRouterApiKey")}</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.openRouterApiKey && (
						<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} appearance="secondary">
							{t("settings:providers.getOpenRouterApiKey")}
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
									{t("settings:providers.useCustomBaseUrl")}
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
								<Trans
									i18nKey="settings:providers.openRouterTransformsText"
									components={{
										// eslint-disable-next-line jsx-a11y/anchor-has-content
										a: <a href="https://openrouter.ai/docs/transforms" />,
									}}
								/>
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
						<div className="font-medium">{t("settings:providers.anthropicApiKey")}</div>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.apiKey && (
						<VSCodeButtonLink href="https://console.anthropic.com/settings/keys" appearance="secondary">
							{t("settings:providers.getAnthropicApiKey")}
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
							{t("settings:providers.useCustomBaseUrl")}
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
						<span className="font-medium">{t("settings:providers.glamaApiKey")}</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.glamaApiKey && (
						<VSCodeButtonLink href={getGlamaAuthUrl(uriScheme)} appearance="secondary">
							{t("settings:providers.getGlamaApiKey")}
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
						placeholder={t("settings:providers.getRequestyApiKey")}
						className="w-full">
						<span className="font-medium">{t("settings:providers.requestyApiKey")}</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
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
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.openAiNativeApiKey && (
						<VSCodeButtonLink href="https://platform.openai.com/api-keys" appearance="secondary">
							{t("settings:providers.getOpenAiApiKey")}
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
						<span className="font-medium">{t("settings:providers.mistralApiKey")}</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.mistralApiKey && (
						<VSCodeButtonLink href="https://console.mistral.ai/" appearance="secondary">
							{t("settings:providers.getMistralApiKey")}
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
								<span className="font-medium">{t("settings:providers.codestralBaseUrl")}</span>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground -mt-2">
								{t("settings:providers.codestralBaseUrlDesc")}
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
						<VSCodeRadio value="credentials">{t("settings:providers.awsCredentials")}</VSCodeRadio>
						<VSCodeRadio value="profile">{t("settings:providers.awsProfile")}</VSCodeRadio>
					</VSCodeRadioGroup>
					<div className="text-sm text-vscode-descriptionForeground -mt-3">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{apiConfiguration?.awsUseProfile ? (
						<VSCodeTextField
							value={apiConfiguration?.awsProfile || ""}
							onInput={handleInputChange("awsProfile")}
							placeholder="Enter profile name"
							className="w-full">
							<span className="font-medium">{t("settings:providers.awsProfileName")}</span>
						</VSCodeTextField>
					) : (
						<>
							<VSCodeTextField
								value={apiConfiguration?.awsAccessKey || ""}
								type="password"
								onInput={handleInputChange("awsAccessKey")}
								placeholder="Enter Access Key..."
								className="w-full">
								<span className="font-medium">{t("settings:providers.awsAccessKey")}</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSecretKey || ""}
								type="password"
								onInput={handleInputChange("awsSecretKey")}
								placeholder="Enter Secret Key..."
								className="w-full">
								<span className="font-medium">{t("settings:providers.awsSecretKey")}</span>
							</VSCodeTextField>
							<VSCodeTextField
								value={apiConfiguration?.awsSessionToken || ""}
								type="password"
								onInput={handleInputChange("awsSessionToken")}
								placeholder="Enter Session Token..."
								className="w-full">
								<span className="font-medium">{t("settings:providers.awsSessionToken")}</span>
							</VSCodeTextField>
						</>
					)}
					<div className="dropdown-container">
						<label htmlFor="aws-region-dropdown" className="font-medium">
							{t("settings:providers.awsRegion")}
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
						{t("settings:providers.awsCrossRegion")}
					</Checkbox>
				</>
			)}

			{selectedProvider === "vertex" && (
				<>
					<div className="text-sm text-vscode-descriptionForeground">
						<div>{t("settings:providers.googleCloudSetup.title")}</div>
						<div>
							<VSCodeLink
								href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
								className="text-sm">
								{t("settings:providers.googleCloudSetup.step1")}
							</VSCodeLink>
						</div>
						<div>
							<VSCodeLink
								href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
								className="text-sm">
								{t("settings:providers.googleCloudSetup.step2")}
							</VSCodeLink>
						</div>
						<div>
							<VSCodeLink
								href="https://developers.google.com/workspace/guides/create-credentials?hl=en#service-account"
								className="text-sm">
								{t("settings:providers.googleCloudSetup.step3")}
							</VSCodeLink>
						</div>
					</div>
					<VSCodeTextField
						value={apiConfiguration?.vertexJsonCredentials || ""}
						onInput={handleInputChange("vertexJsonCredentials")}
						placeholder="Enter Credentials JSON..."
						className="w-full">
						<span className="font-medium">{t("settings:providers.googleCloudCredentials")}</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.vertexKeyFile || ""}
						onInput={handleInputChange("vertexKeyFile")}
						placeholder="Enter Key File Path..."
						className="w-full">
						<span className="font-medium">{t("settings:providers.googleCloudKeyFile")}</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.vertexProjectId || ""}
						onInput={handleInputChange("vertexProjectId")}
						placeholder="Enter Project ID..."
						className="w-full">
						<span className="font-medium">{t("settings:providers.googleCloudProjectId")}</span>
					</VSCodeTextField>
					<div className="dropdown-container">
						<label htmlFor="vertex-region-dropdown" className="font-medium">
							{t("settings:providers.googleCloudRegion")}
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
						<span className="font-medium">{t("settings:providers.geminiApiKey")}</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.geminiApiKey && (
						<VSCodeButtonLink href="https://ai.google.dev/" appearance="secondary">
							{t("settings:providers.getGeminiApiKey")}
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
							{t("settings:providers.useCustomBaseUrl")}
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
						<span className="font-medium">{t("settings:providers.openAiBaseUrl")}</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.openAiApiKey || ""}
						type="password"
						onInput={handleInputChange("openAiApiKey")}
						placeholder="Enter API Key..."
						className="w-full">
						<span className="font-medium">{t("settings:providers.openAiApiKey")}</span>
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
						{t("settings:modelInfo.enableStreaming")}
					</Checkbox>
					<Checkbox
						checked={apiConfiguration?.openAiUseAzure ?? false}
						onChange={handleInputChange("openAiUseAzure", noTransform)}>
						{t("settings:modelInfo.useAzure")}
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
							{t("settings:modelInfo.azureApiVersion")}
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
							{t("settings:providers.customModel.capabilities")}
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
								title={t("settings:providers.customModel.maxTokens.description")}
								onInput={handleInputChange("openAiCustomModelInfo", (e) => {
									const value = parseInt((e.target as HTMLInputElement).value)

									return {
										...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
										maxTokens: isNaN(value) ? undefined : value,
									}
								})}
								placeholder="e.g. 4096"
								className="w-full">
								<span className="font-medium">
									{t("settings:providers.customModel.maxTokens.label")}
								</span>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground">
								{t("settings:providers.customModel.maxTokens.description")}
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
								title={t("settings:providers.customModel.contextWindow.description")}
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
								<span className="font-medium">
									{t("settings:providers.customModel.contextWindow.label")}
								</span>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground">
								{t("settings:providers.customModel.contextWindow.description")}
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
									<span className="font-medium">
										{t("settings:providers.customModel.imageSupport.label")}
									</span>
								</Checkbox>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									title={t("settings:providers.customModel.imageSupport.description")}
									style={{ fontSize: "12px" }}
								/>
							</div>
							<div className="text-sm text-vscode-descriptionForeground pt-1">
								{t("settings:providers.customModel.imageSupport.description")}
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
									<span className="font-medium">
										{t("settings:providers.customModel.computerUse.label")}
									</span>
								</Checkbox>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									title={t("settings:providers.customModel.computerUse.description")}
									style={{ fontSize: "12px" }}
								/>
							</div>
							<div className="text-sm text-vscode-descriptionForeground pt-1">
								{t("settings:providers.customModel.computerUse.description")}
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
									<span className="font-medium">
										{t("settings:providers.customModel.promptCache.label")}
									</span>
								</Checkbox>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									title={t("settings:providers.customModel.promptCache.description")}
									style={{ fontSize: "12px" }}
								/>
							</div>
							<div className="text-sm text-vscode-descriptionForeground pt-1">
								{t("settings:providers.customModel.promptCache.description")}
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
									<span className="font-medium">
										{t("settings:providers.customModel.pricing.input.label")}
									</span>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										title={t("settings:providers.customModel.pricing.input.description")}
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
									<span className="font-medium">
										{t("settings:providers.customModel.pricing.output.label")}
									</span>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										title={t("settings:providers.customModel.pricing.output.description")}
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
											<span className="font-medium">
												{t("settings:providers.customModel.pricing.cacheReads.label")}
											</span>
											<i
												className="codicon codicon-info text-vscode-descriptionForeground"
												title={t(
													"settings:providers.customModel.pricing.cacheReads.description",
												)}
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
											<span className="font-medium">
												{t("settings:providers.customModel.pricing.cacheWrites.label")}
											</span>
											<i
												className="codicon codicon-info text-vscode-descriptionForeground"
												title={t(
													"settings:providers.customModel.pricing.cacheWrites.description",
												)}
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
							{t("settings:providers.customModel.resetDefaults")}
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
						<span className="font-medium">{t("settings:providers.lmStudio.baseUrl")}</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.lmStudioModelId || ""}
						onInput={handleInputChange("lmStudioModelId")}
						placeholder={"e.g. meta-llama-3.1-8b-instruct"}
						className="w-full">
						<span className="font-medium">{t("settings:providers.lmStudio.modelId")}</span>
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
							setApiConfigurationField("lmStudioSpeculativeDecodingEnabled", checked)
						}}>
						{t("settings:providers.lmStudio.speculativeDecoding")}
					</Checkbox>
					{apiConfiguration?.lmStudioSpeculativeDecodingEnabled && (
						<>
							<div>
								<VSCodeTextField
									value={apiConfiguration?.lmStudioDraftModelId || ""}
									onInput={handleInputChange("lmStudioDraftModelId")}
									placeholder={"e.g. lmstudio-community/llama-3.2-1b-instruct"}
									className="w-full">
									<span className="font-medium">{t("settings:providers.lmStudio.draftModelId")}</span>
								</VSCodeTextField>
								<div className="text-sm text-vscode-descriptionForeground">
									{t("settings:providers.lmStudio.draftModelDesc")}
								</div>
							</div>
							{lmStudioModels.length > 0 && (
								<>
									<div className="font-medium">
										{t("settings:providers.lmStudio.selectDraftModel")}
									</div>
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
											{t("settings:providers.lmStudio.noModelsFound")}
										</div>
									)}
								</>
							)}
						</>
					)}
					<div className="text-sm text-vscode-descriptionForeground">
						<Trans
							i18nKey="settings:providers.lmStudio.description"
							components={{
								a: <VSCodeLink href="https://lmstudio.ai/docs" />,
								b: <VSCodeLink href="https://lmstudio.ai/docs/basics/server" />,
								span: (
									<span className="text-vscode-errorForeground ml-1">
										<span className="font-medium">Note:</span>
									</span>
								),
							}}
						/>
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
						<span className="font-medium">{t("settings:providers.deepSeekApiKey")}</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.deepSeekApiKey && (
						<VSCodeButtonLink href="https://platform.deepseek.com/" appearance="secondary">
							{t("settings:providers.getDeepSeekApiKey")}
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "vscode-lm" && (
				<>
					<div className="dropdown-container">
						<label htmlFor="vscode-lm-model" className="font-medium">
							{t("settings:providers.vscodeLmModel")}
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
								{t("settings:providers.vscodeLmDescription")}
							</div>
						)}
					</div>
					<div className="text-sm text-vscode-errorForeground">{t("settings:providers.vscodeLmWarning")}</div>
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
						<span className="font-medium">{t("settings:providers.ollama.baseUrl")}</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.ollamaModelId || ""}
						onInput={handleInputChange("ollamaModelId")}
						placeholder={"e.g. llama3.1"}
						className="w-full">
						<span className="font-medium">{t("settings:providers.ollama.modelId")}</span>
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
						{t("settings:providers.ollama.description")}
						<span className="text-vscode-errorForeground ml-1">
							{t("settings:providers.ollama.warning")}
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
						<span className="font-medium">{t("settings:providers.unboundApiKey")}</span>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.unboundApiKey && (
						<VSCodeButtonLink href="https://gateway.getunbound.ai" appearance="secondary">
							{t("settings:providers.getUnboundApiKey")}
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "human-relay" && (
				<>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.humanRelay.description")}
					</div>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.humanRelay.instructions")}
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
							{t("settings:providers.model")}
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
								{t("settings:providers.awsCustomArnDesc")}
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
												{validation.errorMessage || t("settings:providers.invalidArnFormat")}
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
