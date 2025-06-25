import {
	ApiConfiguration,
	ApiProvider,
	ModelInfo,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	geminiCliDefaultModelId,
	geminiCliModels,
	mistralDefaultModelId,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	mainlandQwenModels,
	internationalQwenModels,
	mainlandQwenDefaultModelId,
	internationalQwenDefaultModelId,
	vertexDefaultModelId,
	vertexModels,
	askSageModels,
	askSageDefaultModelId,
	xaiDefaultModelId,
	xaiModels,
	sambanovaModels,
	sambanovaDefaultModelId,
	doubaoModels,
	doubaoDefaultModelId,
	liteLlmModelInfoSaneDefaults,
	nebiusModels,
	nebiusDefaultModelId,
	cerebrasModels,
	cerebrasDefaultModelId,
	sapAiCoreModels,
	sapAiCoreDefaultModelId,
	claudeCodeDefaultModelId,
	claudeCodeModels,
} from "@shared/api"

/**
 * Interface for normalized API configuration
 */
export interface NormalizedApiConfig {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
}

/**
 * Normalizes API configuration to ensure consistent values
 */
export function normalizeApiConfiguration(apiConfiguration?: ApiConfiguration): NormalizedApiConfig {
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
		case "claude-code":
			return getProviderData(claudeCodeModels, claudeCodeDefaultModelId)
		case "bedrock":
			if (apiConfiguration?.awsBedrockCustomSelected) {
				const baseModelId = apiConfiguration.awsBedrockCustomModelBaseId
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
		case "gemini-cli":
			return getProviderData(geminiCliModels, geminiCliDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "deepseek":
			return getProviderData(deepSeekModels, deepSeekDefaultModelId)
		case "qwen":
			const qwenModels = apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels
			const qwenDefaultId =
				apiConfiguration?.qwenApiLine === "china" ? mainlandQwenDefaultModelId : internationalQwenDefaultModelId
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
				selectedModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "requesty":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
				selectedModelInfo: apiConfiguration?.requestyModelInfo || requestyDefaultModelInfo,
			}
		case "cline":
			const openRouterModelId = apiConfiguration?.openRouterModelId || openRouterDefaultModelId
			const openRouterModelInfo = apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: openRouterModelId,
				// TODO: remove this once we have a better way to handle free models on Cline
				// Free grok 3 promotion
				selectedModelInfo:
					openRouterModelId === "x-ai/grok-3"
						? { ...openRouterModelInfo, inputPrice: 0, outputPrice: 0 }
						: openRouterModelInfo,
			}
		case "openai":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openAiModelId || "",
				selectedModelInfo: apiConfiguration?.openAiModelInfo || openAiModelInfoSaneDefaults,
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
					supportsImages: false, // VSCode LM API currently doesn't support images
				},
			}
		case "litellm":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.liteLlmModelId || "",
				selectedModelInfo: apiConfiguration?.liteLlmModelInfo || liteLlmModelInfoSaneDefaults,
			}
		case "xai":
			return getProviderData(xaiModels, xaiDefaultModelId)
		case "nebius":
			return getProviderData(nebiusModels, nebiusDefaultModelId)
		case "sambanova":
			return getProviderData(sambanovaModels, sambanovaDefaultModelId)
		case "cerebras":
			return getProviderData(cerebrasModels, cerebrasDefaultModelId)
		case "sapaicore":
			return getProviderData(sapAiCoreModels, sapAiCoreDefaultModelId)
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

/**
 * Gets the OpenRouter authentication URL
 */
export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${uriScheme || "vscode"}://saoudrizwan.claude-dev/openrouter`
}
