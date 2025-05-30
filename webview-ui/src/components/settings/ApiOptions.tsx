import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { convertHeadersToObject } from "./utils/headers"
import { useDebounce } from "react-use"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderName,
	type ProviderSettings,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	glamaDefaultModelId,
	unboundDefaultModelId,
	litellmDefaultModelId,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { validateApiConfiguration } from "@src/utils/validate"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { filterProviders, filterModels } from "./utils/organizationFilters"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import {
	Anthropic,
	Bedrock,
	Chutes,
	DeepSeek,
	Gemini,
	Glama,
	Groq,
	LMStudio,
	LiteLLM,
	Mistral,
	Ollama,
	OpenAI,
	OpenAICompatible,
	OpenRouter,
	Requesty,
	Unbound,
	Vertex,
	VSCodeLM,
	XAI,
} from "./providers"

import { MODELS_BY_PROVIDER, PROVIDERS } from "./constants"
import { inputEventTransform, noTransform } from "./transforms"
import { ModelInfoView } from "./ModelInfoView"
import { ApiErrorMessage } from "./ApiErrorMessage"
import { ThinkingBudget } from "./ThinkingBudget"
import { DiffSettingsControl } from "./DiffSettingsControl"
import { TemperatureControl } from "./TemperatureControl"
import { RateLimitSecondsControl } from "./RateLimitSecondsControl"
import { BedrockCustomArn } from "./providers/BedrockCustomArn"
import { buildDocLink } from "@src/utils/docLinks"

export interface ApiOptionsProps {
	uriScheme: string | undefined
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
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
	const { organizationAllowList } = useExtensionState()

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

	// Debounced effect to update the main configuration when local
	// customHeaders state stabilizes.
	useDebounce(
		() => {
			const currentConfigHeaders = apiConfiguration?.openAiHeaders || {}
			const newHeadersObject = convertHeadersToObject(customHeaders)

			// Only update if the processed object is different from the current config.
			if (JSON.stringify(currentConfigHeaders) !== JSON.stringify(newHeadersObject)) {
				setApiConfigurationField("openAiHeaders", newHeadersObject)
			}
		},
		300,
		[customHeaders, apiConfiguration?.openAiHeaders, setApiConfigurationField],
	)

	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
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

	const { data: routerModels, refetch: refetchRouterModels } = useRouterModels()

	// Update `apiModelId` whenever `selectedModelId` changes.
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
			} else if (selectedProvider === "litellm") {
				vscode.postMessage({ type: "requestRouterModels" })
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
			apiConfiguration?.litellmBaseUrl,
			apiConfiguration?.litellmApiKey,
			customHeaders,
		],
	)

	useEffect(() => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration, routerModels, organizationAllowList)

		setErrorMessage(apiValidationResult)
	}, [apiConfiguration, routerModels, organizationAllowList, setErrorMessage])

	const selectedProviderModels = useMemo(() => {
		const models = MODELS_BY_PROVIDER[selectedProvider]
		if (!models) return []

		const filteredModels = filterModels(models, selectedProvider, organizationAllowList)

		return filteredModels
			? Object.keys(filteredModels).map((modelId) => ({
					value: modelId,
					label: modelId,
				}))
			: []
	}, [selectedProvider, organizationAllowList])

	const onProviderChange = useCallback(
		(value: ProviderName) => {
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
				case "litellm":
					if (!apiConfiguration.litellmModelId) {
						setApiConfigurationField("litellmModelId", litellmDefaultModelId)
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
			apiConfiguration.litellmModelId,
		],
	)

	const docs = useMemo(() => {
		const provider = PROVIDERS.find(({ value }) => value === selectedProvider)
		const name = provider?.label

		if (!name) {
			return undefined
		}

		// Get the URL slug - use custom mapping if available, otherwise use the provider key.
		const slugs: Record<string, string> = {
			"openai-native": "openai",
			openai: "openai-compatible",
		}

		const slug = slugs[selectedProvider] || selectedProvider
		return {
			url: buildDocLink(`providers/${slug}`, "provider_docs"),
			name,
		}
	}, [selectedProvider])

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1 relative">
				<div className="flex justify-between items-center">
					<label className="block font-medium mb-1">{t("settings:providers.apiProvider")}</label>
					{docs && (
						<div className="text-xs text-vscode-descriptionForeground">
							<VSCodeLink href={docs.url} className="hover:text-vscode-foreground" target="_blank">
								{t("settings:providers.providerDocumentation", { provider: docs.name })}
							</VSCodeLink>
						</div>
					)}
				</div>
				<Select value={selectedProvider} onValueChange={(value) => onProviderChange(value as ProviderName)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						{filterProviders(PROVIDERS, organizationAllowList).map(({ value, label }) => (
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
					routerModels={routerModels}
					selectedModelId={selectedModelId}
					uriScheme={uriScheme}
					fromWelcomeView={fromWelcomeView}
					organizationAllowList={organizationAllowList}
				/>
			)}

			{selectedProvider === "requesty" && (
				<Requesty
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					refetchRouterModels={refetchRouterModels}
					organizationAllowList={organizationAllowList}
				/>
			)}

			{selectedProvider === "glama" && (
				<Glama
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					uriScheme={uriScheme}
					organizationAllowList={organizationAllowList}
				/>
			)}

			{selectedProvider === "unbound" && (
				<Unbound
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
				/>
			)}

			{selectedProvider === "anthropic" && (
				<Anthropic apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "openai-native" && (
				<OpenAI apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "mistral" && (
				<Mistral apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
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
					organizationAllowList={organizationAllowList}
				/>
			)}

			{selectedProvider === "lmstudio" && (
				<LMStudio apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "deepseek" && (
				<DeepSeek apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "vscode-lm" && (
				<VSCodeLM apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "ollama" && (
				<Ollama apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "xai" && (
				<XAI apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "groq" && (
				<Groq apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "chutes" && (
				<Chutes apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "litellm" && (
				<LiteLLM
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					organizationAllowList={organizationAllowList}
				/>
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

			{selectedProviderModels.length > 0 && (
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
								{selectedProviderModels.map((option) => (
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
						<BedrockCustomArn
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					<ModelInfoView
						apiProvider={selectedProvider}
						selectedModelId={selectedModelId}
						modelInfo={selectedModelInfo}
						isDescriptionExpanded={isDescriptionExpanded}
						setIsDescriptionExpanded={setIsDescriptionExpanded}
					/>
				</>
			)}

			<ThinkingBudget
				key={`${selectedProvider}-${selectedModelId}`}
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				modelInfo={selectedModelInfo}
			/>

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
