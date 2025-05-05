import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useDebounce } from "react-use"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ExternalLinkIcon } from "@radix-ui/react-icons"

import {
	ApiConfiguration,
	glamaDefaultModelId,
	mistralDefaultModelId,
	openRouterDefaultModelId,
	unboundDefaultModelId,
	requestyDefaultModelId,
	ApiProvider,
} from "@roo/shared/api"

import { vscode } from "@src/utils/vscode"
import { validateApiConfiguration, validateModelId, validateBedrockArn } from "@src/utils/validate"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/components/ui/hooks/useOpenRouterModelProviders"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { getRequestyAuthUrl, getGlamaAuthUrl } from "@src/oauth/urls"

// Providers
import { Anthropic } from "./providers/Anthropic"
import { Bedrock } from "./providers/Bedrock"
import { Gemini } from "./providers/Gemini"
import { LMStudio } from "./providers/LMStudio"
import { Ollama } from "./providers/Ollama"
import { OpenAI } from "./providers/OpenAI"
import { OpenAICompatible } from "./providers/OpenAICompatible"
import { OpenRouter } from "./providers/OpenRouter"
import { Vertex } from "./providers/Vertex"
import { VSCodeLM } from "./providers/VSCodeLM"

import { MODELS_BY_PROVIDER, PROVIDERS, REASONING_MODELS } from "./constants"
import { inputEventTransform, noTransform } from "./transforms"
import { ModelInfoView } from "./ModelInfoView"
import { ModelPicker } from "./ModelPicker"
import { ApiErrorMessage } from "./ApiErrorMessage"
import { ThinkingBudget } from "./ThinkingBudget"
import { RequestyBalanceDisplay } from "./RequestyBalanceDisplay"
import { ReasoningEffort } from "./ReasoningEffort"
import { PromptCachingControl } from "./PromptCachingControl"
import { DiffSettingsControl } from "./DiffSettingsControl"
import { TemperatureControl } from "./TemperatureControl"
import { RateLimitSecondsControl } from "./RateLimitSecondsControl"

export interface ApiOptionsProps {
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

	const [customHeaders, setCustomHeaders] = useState<[string, string][]>(() => {
		const headers = apiConfiguration?.openAiHeaders || {}
		return Object.entries(headers)
	})

	useEffect(() => {
		const propHeaders = apiConfiguration?.openAiHeaders || {}

		if (JSON.stringify(customHeaders) !== JSON.stringify(Object.entries(propHeaders))) {
			setCustomHeaders(Object.entries(propHeaders))
		}
	}, [apiConfiguration?.openAiHeaders, customHeaders])

	// Helper to convert array of tuples to object (filtering out empty keys).
	const convertHeadersToObject = (headers: [string, string][]): Record<string, string> => {
		const result: Record<string, string> = {}

		// Process each header tuple.
		for (const [key, value] of headers) {
			const trimmedKey = key.trim()

			// Skip empty keys.
			if (!trimmedKey) {
				continue
			}

			// For duplicates, the last one in the array wins.
			// This matches how HTTP headers work in general.
			result[trimmedKey] = value.trim()
		}

		return result
	}

	// Debounced effect to update the main configuration when local customHeaders state stabilizes.
	useDebounce(
		() => {
			const currentConfigHeaders = apiConfiguration?.openAiHeaders || {}
			const newHeadersObject = convertHeadersToObject(customHeaders)

			// Only update if the processed object is different from the current config
			if (JSON.stringify(currentConfigHeaders) !== JSON.stringify(newHeadersObject)) {
				setApiConfigurationField("openAiHeaders", newHeadersObject)
			}
		},
		300,
		[customHeaders, apiConfiguration?.openAiHeaders, setApiConfigurationField],
	)

	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

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

	const {
		provider: selectedProvider,
		id: selectedModelId,
		info: selectedModelInfo,
	} = useSelectedModel(apiConfiguration)

	const { data: routerModels } = useRouterModels()

	// Update apiConfiguration.aiModelId whenever selectedModelId changes.
	useEffect(() => {
		if (selectedModelId) {
			setApiConfigurationField("apiModelId", selectedModelId)
		}
	}, [selectedModelId, setApiConfigurationField])

	// Debounced refresh model updates, only executed 250ms after the user
	// stops typing.
	useDebounce(
		() => {
			if (selectedProvider === "openai") {
				// Use our custom headers state to build the headers object.
				const headerObject = convertHeadersToObject(customHeaders)

				vscode.postMessage({
					type: "requestOpenAiModels",
					values: {
						baseUrl: apiConfiguration?.openAiBaseUrl,
						apiKey: apiConfiguration?.openAiApiKey,
						customHeaders: {}, // Reserved for any additional headers
						openAiHeaders: headerObject,
					},
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
			customHeaders,
		],
	)

	useEffect(() => {
		const apiValidationResult =
			validateApiConfiguration(apiConfiguration) || validateModelId(apiConfiguration, routerModels)

		setErrorMessage(apiValidationResult)
	}, [apiConfiguration, routerModels, setErrorMessage])

	const { data: openRouterModelProviders } = useOpenRouterModelProviders(apiConfiguration?.openRouterModelId, {
		enabled:
			selectedProvider === "openrouter" &&
			!!apiConfiguration?.openRouterModelId &&
			routerModels?.openrouter &&
			Object.keys(routerModels.openrouter).length > 1 &&
			apiConfiguration.openRouterModelId in routerModels.openrouter,
	})

	const selectedProviderModelOptions = useMemo(
		() =>
			MODELS_BY_PROVIDER[selectedProvider]
				? Object.keys(MODELS_BY_PROVIDER[selectedProvider]).map((modelId) => ({
						value: modelId,
						label: modelId,
					}))
				: [],
		[selectedProvider],
	)

	// Custom URL path mappings for providers with different slugs.
	const providerUrlSlugs: Record<string, string> = {
		"openai-native": "openai",
		openai: "openai-compatible",
	}

	// Helper function to get provider display name from PROVIDERS constant.
	const getProviderDisplayName = (providerKey: string): string | undefined => {
		const provider = PROVIDERS.find((p) => p.value === providerKey)
		return provider?.label
	}

	// Helper function to get the documentation URL and name for the currently selected provider
	const getSelectedProviderDocUrl = (): { url: string; name: string } | undefined => {
		const displayName = getProviderDisplayName(selectedProvider)

		if (!displayName) {
			return undefined
		}

		// Get the URL slug - use custom mapping if available, otherwise use the provider key
		const urlSlug = providerUrlSlugs[selectedProvider] || selectedProvider

		return {
			url: `https://docs.roocode.com/providers/${urlSlug}`,
			name: displayName,
		}
	}

	const onApiProviderChange = useCallback(
		(value: ApiProvider) => {
			// It would be much easier to have a single attribute that stores
			// the modelId, but we have a separate attribute for each of
			// OpenRouter, Glama, Unbound, and Requesty.
			// If you switch to one of these providers and the corresponding
			// modelId is not set then you immediately end up in an error state.
			// To address that we set the modelId to the default value for th
			// provider if it's not already set.
			switch (value) {
				case "openrouter":
					if (!apiConfiguration.openRouterModelId) {
						setApiConfigurationField("openRouterModelId", openRouterDefaultModelId)
					}
					break
				case "glama":
					if (!apiConfiguration.glamaModelId) {
						setApiConfigurationField("glamaModelId", glamaDefaultModelId)
					}
					break
				case "unbound":
					if (!apiConfiguration.unboundModelId) {
						setApiConfigurationField("unboundModelId", unboundDefaultModelId)
					}
					break
				case "requesty":
					if (!apiConfiguration.requestyModelId) {
						setApiConfigurationField("requestyModelId", requestyDefaultModelId)
					}
					break
			}

			setApiConfigurationField("apiProvider", value)
		},
		[
			setApiConfigurationField,
			apiConfiguration.openRouterModelId,
			apiConfiguration.glamaModelId,
			apiConfiguration.unboundModelId,
			apiConfiguration.requestyModelId,
		],
	)

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1 relative">
				<div className="flex justify-between items-center">
					<label className="block font-medium mb-1">{t("settings:providers.apiProvider")}</label>
					{getSelectedProviderDocUrl() && (
						<div className="text-xs text-vscode-descriptionForeground">
							<VSCodeLink
								href={getSelectedProviderDocUrl()!.url}
								className="hover:text-vscode-foreground"
								target="_blank">
								{t("settings:providers.providerDocumentation", {
									provider: getSelectedProviderDocUrl()!.name,
								})}
							</VSCodeLink>
						</div>
					)}
				</div>
				<Select value={selectedProvider} onValueChange={(value) => onApiProviderChange(value as ApiProvider)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						{PROVIDERS.map(({ value, label }) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{errorMessage && <ApiErrorMessage errorMessage={errorMessage} />}

			{selectedProvider === "openrouter" && (
				<OpenRouter
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					uriScheme={uriScheme}
					fromWelcomeView={fromWelcomeView}
				/>
			)}

			{selectedProvider === "anthropic" && (
				<Anthropic apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "glama" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.glamaApiKey || ""}
						type="password"
						onInput={handleInputChange("glamaApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.glamaApiKey")}</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.glamaApiKey && (
						<VSCodeButtonLink
							href={getGlamaAuthUrl(uriScheme)}
							style={{ width: "100%" }}
							appearance="primary">
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
						<div className="flex justify-between items-center mb-1">
							<label className="block font-medium">{t("settings:providers.requestyApiKey")}</label>
							{apiConfiguration?.requestyApiKey && (
								<RequestyBalanceDisplay apiKey={apiConfiguration.requestyApiKey} />
							)}
						</div>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.requestyApiKey && (
						<VSCodeButtonLink
							href={getRequestyAuthUrl(uriScheme)}
							style={{ width: "100%" }}
							appearance="primary">
							{t("settings:providers.getRequestyApiKey")}
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "openai-native" && (
				<OpenAI apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "mistral" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.mistralApiKey || ""}
						type="password"
						onInput={handleInputChange("mistralApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
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
								<label className="block font-medium mb-1">
									{t("settings:providers.codestralBaseUrl")}
								</label>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground -mt-2">
								{t("settings:providers.codestralBaseUrlDesc")}
							</div>
						</>
					)}
				</>
			)}

			{selectedProvider === "bedrock" && (
				<Bedrock
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					selectedModelInfo={selectedModelInfo}
				/>
			)}

			{selectedProvider === "vertex" && (
				<Vertex apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "gemini" && (
				<Gemini apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "openai" && (
				<OpenAICompatible
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
				/>
			)}

			{selectedProvider === "lmstudio" && (
				<LMStudio apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "deepseek" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.deepSeekApiKey || ""}
						type="password"
						onInput={handleInputChange("deepSeekApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.deepSeekApiKey")}</label>
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
				<VSCodeLM apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "ollama" && (
				<Ollama apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "xai" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.xaiApiKey || ""}
						type="password"
						onInput={handleInputChange("xaiApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.xaiApiKey")}</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.xaiApiKey && (
						<VSCodeButtonLink href="https://api.x.ai/docs" appearance="secondary">
							{t("settings:providers.getXaiApiKey")}
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "groq" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.groqApiKey || ""}
						type="password"
						onInput={handleInputChange("groqApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.groqApiKey")}</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.groqApiKey && (
						<VSCodeButtonLink href="https://console.groq.com/keys" appearance="secondary">
							{t("settings:providers.getGroqApiKey")}
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "chutes" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.chutesApiKey || ""}
						type="password"
						onInput={handleInputChange("chutesApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.chutesApiKey")}</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.apiKeyStorageNotice")}
					</div>
					{!apiConfiguration?.chutesApiKey && (
						<VSCodeButtonLink href="https://chutes.ai/app/api" appearance="secondary">
							{t("settings:providers.getChutesApiKey")}
						</VSCodeButtonLink>
					)}
				</>
			)}

			{selectedProvider === "unbound" && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.unboundApiKey || ""}
						type="password"
						onInput={handleInputChange("unboundApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.unboundApiKey")}</label>
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
					models={routerModels?.openrouter ?? {}}
					modelIdKey="openRouterModelId"
					serviceName="OpenRouter"
					serviceUrl="https://openrouter.ai/models"
				/>
			)}

			{selectedProvider === "openrouter" &&
				openRouterModelProviders &&
				Object.keys(openRouterModelProviders).length > 0 && (
					<div>
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">
								{t("settings:providers.openRouter.providerRouting.title")}
							</label>
							<a href={`https://openrouter.ai/${selectedModelId}/providers`}>
								<ExternalLinkIcon className="w-4 h-4" />
							</a>
						</div>
						<Select
							value={apiConfiguration?.openRouterSpecificProvider || OPENROUTER_DEFAULT_PROVIDER_NAME}
							onValueChange={(value) => setApiConfigurationField("openRouterSpecificProvider", value)}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
									{OPENROUTER_DEFAULT_PROVIDER_NAME}
								</SelectItem>
								{Object.entries(openRouterModelProviders).map(([value, { label }]) => (
									<SelectItem key={value} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<div className="text-sm text-vscode-descriptionForeground mt-1">
							{t("settings:providers.openRouter.providerRouting.description")}{" "}
							<a href="https://openrouter.ai/docs/features/provider-routing">
								{t("settings:providers.openRouter.providerRouting.learnMore")}.
							</a>
						</div>
					</div>
				)}

			{selectedProvider === "glama" && (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId={glamaDefaultModelId}
					models={routerModels?.glama ?? {}}
					modelIdKey="glamaModelId"
					serviceName="Glama"
					serviceUrl="https://glama.ai/models"
				/>
			)}

			{selectedProvider === "unbound" && (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					defaultModelId={unboundDefaultModelId}
					models={routerModels?.unbound ?? {}}
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
					models={routerModels?.requesty ?? {}}
					modelIdKey="requestyModelId"
					serviceName="Requesty"
					serviceUrl="https://requesty.ai"
				/>
			)}

			{selectedProviderModelOptions.length > 0 && (
				<>
					<div>
						<label className="block font-medium mb-1">{t("settings:providers.model")}</label>

						<Select
							value={selectedModelId === "custom-arn" ? "custom-arn" : selectedModelId}
							onValueChange={(value) => {
								setApiConfigurationField("apiModelId", value)

								// Clear custom ARN if not using custom ARN option.
								if (value !== "custom-arn" && selectedProvider === "bedrock") {
									setApiConfigurationField("awsCustomArn", "")
								}
							}}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								{selectedProviderModelOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
								{selectedProvider === "bedrock" && (
									<SelectItem value="custom-arn">{t("settings:labels.useCustomArn")}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>

					{selectedProvider === "bedrock" && selectedModelId === "custom-arn" && (
						<>
							<VSCodeTextField
								value={apiConfiguration?.awsCustomArn || ""}
								onInput={(e) => {
									const value = (e.target as HTMLInputElement).value
									setApiConfigurationField("awsCustomArn", value)
								}}
								placeholder={t("settings:placeholders.customArn")}
								className="w-full">
								<label className="block font-medium mb-1">{t("settings:labels.customArn")}</label>
							</VSCodeTextField>
							<div className="text-sm text-vscode-descriptionForeground -mt-2">
								{t("settings:providers.awsCustomArnUse")}
								<ul className="list-disc pl-5 mt-1">
									<li>
										arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-3-7-sonnet-20250219-v1:0
									</li>
									<li>
										arn:aws:bedrock:us-west-2:123456789012:provisioned-model/my-provisioned-model
									</li>
									<li>
										arn:aws:bedrock:us-east-1:123456789012:default-prompt-router/anthropic.claude:1
									</li>
								</ul>
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
						apiProvider={selectedProvider}
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

			{REASONING_MODELS.has(selectedModelId) && (
				<ReasoningEffort
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
				/>
			)}

			{selectedModelInfo && selectedModelInfo.supportsPromptCache && selectedModelInfo.isPromptCacheOptional && (
				<PromptCachingControl
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
				/>
			)}

			{!fromWelcomeView && (
				<>
					<DiffSettingsControl
						diffEnabled={apiConfiguration.diffEnabled}
						fuzzyMatchThreshold={apiConfiguration.fuzzyMatchThreshold}
						onChange={(field, value) => setApiConfigurationField(field, value)}
					/>
					<TemperatureControl
						value={apiConfiguration.modelTemperature}
						onChange={handleInputChange("modelTemperature", noTransform)}
						maxValue={2}
					/>
					<RateLimitSecondsControl
						value={apiConfiguration.rateLimitSeconds || 0}
						onChange={(value) => setApiConfigurationField("rateLimitSeconds", value)}
					/>
				</>
			)}
		</div>
	)
}

export default memo(ApiOptions)
