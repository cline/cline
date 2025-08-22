import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { convertHeadersToObject } from "./utils/headers"
import { useDebounce } from "react-use"
import { VSCodeLink, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ExternalLinkIcon } from "@radix-ui/react-icons"

import {
	type ProviderName,
	type ProviderSettings,
	DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	glamaDefaultModelId,
	unboundDefaultModelId,
	litellmDefaultModelId,
	openAiNativeDefaultModelId,
	anthropicDefaultModelId,
	doubaoDefaultModelId,
	claudeCodeDefaultModelId,
	geminiDefaultModelId,
	deepSeekDefaultModelId,
	moonshotDefaultModelId,
	mistralDefaultModelId,
	xaiDefaultModelId,
	groqDefaultModelId,
	cerebrasDefaultModelId,
	chutesDefaultModelId,
	bedrockDefaultModelId,
	vertexDefaultModelId,
	sambaNovaDefaultModelId,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	fireworksDefaultModelId,
	featherlessDefaultModelId,
	ioIntelligenceDefaultModelId,
	rooDefaultModelId,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { validateApiConfigurationExcludingModelErrors, getModelValidationError } from "@src/utils/validate"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/components/ui/hooks/useOpenRouterModelProviders"
import { filterProviders, filterModels } from "./utils/organizationFilters"
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
	SearchableSelect,
	Collapsible,
	CollapsibleTrigger,
	CollapsibleContent,
} from "@src/components/ui"

import {
	Anthropic,
	Bedrock,
	Cerebras,
	Chutes,
	ClaudeCode,
	DeepSeek,
	Doubao,
	Gemini,
	Glama,
	Groq,
	HuggingFace,
	IOIntelligence,
	LMStudio,
	LiteLLM,
	Mistral,
	Moonshot,
	Ollama,
	OpenAI,
	OpenAICompatible,
	OpenRouter,
	Requesty,
	SambaNova,
	Unbound,
	Vertex,
	VSCodeLM,
	XAI,
	ZAi,
	Fireworks,
	Featherless,
} from "./providers"

import { MODELS_BY_PROVIDER, PROVIDERS } from "./constants"
import { inputEventTransform, noTransform } from "./transforms"
import { ModelInfoView } from "./ModelInfoView"
import { ApiErrorMessage } from "./ApiErrorMessage"
import { ThinkingBudget } from "./ThinkingBudget"
import { Verbosity } from "./Verbosity"
import { DiffSettingsControl } from "./DiffSettingsControl"
import { TodoListSettingsControl } from "./TodoListSettingsControl"
import { TemperatureControl } from "./TemperatureControl"
import { RateLimitSecondsControl } from "./RateLimitSecondsControl"
import { ConsecutiveMistakeLimitControl } from "./ConsecutiveMistakeLimitControl"
import { BedrockCustomArn } from "./providers/BedrockCustomArn"
import { buildDocLink } from "@src/utils/docLinks"

export interface ApiOptionsProps {
	uriScheme: string | undefined
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
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
	const { organizationAllowList, cloudIsAuthenticated } = useExtensionState()

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
	const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false)

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

	const { data: openRouterModelProviders } = useOpenRouterModelProviders(apiConfiguration?.openRouterModelId, {
		enabled:
			!!apiConfiguration?.openRouterModelId &&
			routerModels?.openrouter &&
			Object.keys(routerModels.openrouter).length > 1 &&
			apiConfiguration.openRouterModelId in routerModels.openrouter,
	})

	// Update `apiModelId` whenever `selectedModelId` changes.
	useEffect(() => {
		if (selectedModelId && apiConfiguration.apiModelId !== selectedModelId) {
			setApiConfigurationField("apiModelId", selectedModelId)
		}
	}, [selectedModelId, setApiConfigurationField, apiConfiguration.apiModelId])

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
				vscode.postMessage({ type: "requestOllamaModels" })
			} else if (selectedProvider === "lmstudio") {
				vscode.postMessage({ type: "requestLmStudioModels" })
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
		const apiValidationResult = validateApiConfigurationExcludingModelErrors(
			apiConfiguration,
			routerModels,
			organizationAllowList,
		)
		setErrorMessage(apiValidationResult)
	}, [apiConfiguration, routerModels, organizationAllowList, setErrorMessage])

	const selectedProviderModels = useMemo(() => {
		const models = MODELS_BY_PROVIDER[selectedProvider]
		if (!models) return []

		const filteredModels = filterModels(models, selectedProvider, organizationAllowList)

		const modelOptions = filteredModels
			? Object.keys(filteredModels).map((modelId) => ({
					value: modelId,
					label: modelId,
				}))
			: []

		return modelOptions
	}, [selectedProvider, organizationAllowList])

	const onProviderChange = useCallback(
		(value: ProviderName) => {
			setApiConfigurationField("apiProvider", value)

			// It would be much easier to have a single attribute that stores
			// the modelId, but we have a separate attribute for each of
			// OpenRouter, Glama, Unbound, and Requesty.
			// If you switch to one of these providers and the corresponding
			// modelId is not set then you immediately end up in an error state.
			// To address that we set the modelId to the default value for th
			// provider if it's not already set.
			const validateAndResetModel = (
				modelId: string | undefined,
				field: keyof ProviderSettings,
				defaultValue?: string,
			) => {
				// in case we haven't set a default value for a provider
				if (!defaultValue) return

				// only set default if no model is set, but don't reset invalid models
				// let users see and decide what to do with invalid model selections
				const shouldSetDefault = !modelId

				if (shouldSetDefault) {
					setApiConfigurationField(field, defaultValue, false)
				}
			}

			// Define a mapping object that associates each provider with its model configuration
			const PROVIDER_MODEL_CONFIG: Partial<
				Record<
					ProviderName,
					{
						field: keyof ProviderSettings
						default?: string
					}
				>
			> = {
				openrouter: { field: "openRouterModelId", default: openRouterDefaultModelId },
				glama: { field: "glamaModelId", default: glamaDefaultModelId },
				unbound: { field: "unboundModelId", default: unboundDefaultModelId },
				requesty: { field: "requestyModelId", default: requestyDefaultModelId },
				litellm: { field: "litellmModelId", default: litellmDefaultModelId },
				anthropic: { field: "apiModelId", default: anthropicDefaultModelId },
				cerebras: { field: "apiModelId", default: cerebrasDefaultModelId },
				"claude-code": { field: "apiModelId", default: claudeCodeDefaultModelId },
				"openai-native": { field: "apiModelId", default: openAiNativeDefaultModelId },
				gemini: { field: "apiModelId", default: geminiDefaultModelId },
				deepseek: { field: "apiModelId", default: deepSeekDefaultModelId },
				doubao: { field: "apiModelId", default: doubaoDefaultModelId },
				moonshot: { field: "apiModelId", default: moonshotDefaultModelId },
				mistral: { field: "apiModelId", default: mistralDefaultModelId },
				xai: { field: "apiModelId", default: xaiDefaultModelId },
				groq: { field: "apiModelId", default: groqDefaultModelId },
				chutes: { field: "apiModelId", default: chutesDefaultModelId },
				bedrock: { field: "apiModelId", default: bedrockDefaultModelId },
				vertex: { field: "apiModelId", default: vertexDefaultModelId },
				sambanova: { field: "apiModelId", default: sambaNovaDefaultModelId },
				zai: {
					field: "apiModelId",
					default:
						apiConfiguration.zaiApiLine === "china"
							? mainlandZAiDefaultModelId
							: internationalZAiDefaultModelId,
				},
				fireworks: { field: "apiModelId", default: fireworksDefaultModelId },
				featherless: { field: "apiModelId", default: featherlessDefaultModelId },
				"io-intelligence": { field: "ioIntelligenceModelId", default: ioIntelligenceDefaultModelId },
				roo: { field: "apiModelId", default: rooDefaultModelId },
				openai: { field: "openAiModelId" },
				ollama: { field: "ollamaModelId" },
				lmstudio: { field: "lmStudioModelId" },
			}

			const config = PROVIDER_MODEL_CONFIG[value]
			if (config) {
				validateAndResetModel(
					apiConfiguration[config.field] as string | undefined,
					config.field,
					config.default,
				)
			}
		},
		[setApiConfigurationField, apiConfiguration],
	)

	const modelValidationError = useMemo(() => {
		return getModelValidationError(apiConfiguration, routerModels, organizationAllowList)
	}, [apiConfiguration, routerModels, organizationAllowList])

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

	// Convert providers to SearchableSelect options
	const providerOptions = useMemo(() => {
		return filterProviders(PROVIDERS, organizationAllowList).map(({ value, label }) => ({
			value,
			label,
		}))
	}, [organizationAllowList])

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
				<SearchableSelect
					value={selectedProvider}
					onValueChange={(value) => onProviderChange(value as ProviderName)}
					options={providerOptions}
					placeholder={t("settings:common.select")}
					searchPlaceholder={t("settings:providers.searchProviderPlaceholder")}
					emptyMessage={t("settings:providers.noProviderMatchFound")}
					className="w-full"
					data-testid="provider-select"
				/>
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
					modelValidationError={modelValidationError}
				/>
			)}

			{selectedProvider === "requesty" && (
				<Requesty
					uriScheme={uriScheme}
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					refetchRouterModels={refetchRouterModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}

			{selectedProvider === "glama" && (
				<Glama
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					uriScheme={uriScheme}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}

			{selectedProvider === "unbound" && (
				<Unbound
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}

			{selectedProvider === "anthropic" && (
				<Anthropic apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "claude-code" && (
				<ClaudeCode apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
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
				<Vertex
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					fromWelcomeView={fromWelcomeView}
				/>
			)}

			{selectedProvider === "gemini" && (
				<Gemini
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					fromWelcomeView={fromWelcomeView}
				/>
			)}

			{selectedProvider === "openai" && (
				<OpenAICompatible
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}

			{selectedProvider === "lmstudio" && (
				<LMStudio apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "deepseek" && (
				<DeepSeek apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "doubao" && (
				<Doubao apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "moonshot" && (
				<Moonshot apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
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

			{selectedProvider === "huggingface" && (
				<HuggingFace apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "cerebras" && (
				<Cerebras apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "chutes" && (
				<Chutes apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "litellm" && (
				<LiteLLM
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}

			{selectedProvider === "sambanova" && (
				<SambaNova apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "zai" && (
				<ZAi apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "io-intelligence" && (
				<IOIntelligence
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
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

			{selectedProvider === "fireworks" && (
				<Fireworks apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "roo" && (
				<div className="flex flex-col gap-3">
					{cloudIsAuthenticated ? (
						<div className="text-sm text-vscode-descriptionForeground">
							{t("settings:providers.roo.authenticatedMessage")}
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<VSCodeButton
								appearance="primary"
								onClick={() => vscode.postMessage({ type: "rooCloudSignIn" })}
								className="w-fit">
								{t("settings:providers.roo.connectButton")}
							</VSCodeButton>
						</div>
					)}
				</div>
			)}

			{selectedProvider === "featherless" && (
				<Featherless apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
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

								// Clear reasoning effort when switching models to allow the new model's default to take effect
								// This is especially important for GPT-5 models which default to "medium"
								if (selectedProvider === "openai-native") {
									setApiConfigurationField("reasoningEffort", undefined)
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

			{/* Gate Verbosity UI by capability flag */}
			{selectedModelInfo?.supportsVerbosity && (
				<Verbosity
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					modelInfo={selectedModelInfo}
				/>
			)}

			{!fromWelcomeView && (
				<Collapsible open={isAdvancedSettingsOpen} onOpenChange={setIsAdvancedSettingsOpen}>
					<CollapsibleTrigger className="flex items-center gap-1 w-full cursor-pointer hover:opacity-80 mb-2">
						<span className={`codicon codicon-chevron-${isAdvancedSettingsOpen ? "down" : "right"}`}></span>
						<span className="font-medium">{t("settings:advancedSettings.title")}</span>
					</CollapsibleTrigger>
					<CollapsibleContent className="space-y-3">
						<TodoListSettingsControl
							todoListEnabled={apiConfiguration.todoListEnabled}
							onChange={(field, value) => setApiConfigurationField(field, value)}
						/>
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
						<ConsecutiveMistakeLimitControl
							value={
								apiConfiguration.consecutiveMistakeLimit !== undefined
									? apiConfiguration.consecutiveMistakeLimit
									: DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
							}
							onChange={(value) => setApiConfigurationField("consecutiveMistakeLimit", value)}
						/>
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
										value={
											apiConfiguration?.openRouterSpecificProvider ||
											OPENROUTER_DEFAULT_PROVIDER_NAME
										}
										onValueChange={(value) =>
											setApiConfigurationField("openRouterSpecificProvider", value)
										}>
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
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	)
}

export default memo(ApiOptions)
