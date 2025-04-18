import {
	ApiConfiguration,
	ApiProvider,
	ModelInfo,
	anthropicModels,
	anthropicDefaultModelId,
	bedrockModels,
	bedrockDefaultModelId,
	vertexModels,
	vertexDefaultModelId,
	geminiModels,
	geminiDefaultModelId,
	openAiNativeModels,
	openAiNativeDefaultModelId,
	deepSeekModels,
	deepSeekDefaultModelId,
	mainlandQwenModels,
	internationalQwenModels,
	mainlandQwenDefaultModelId,
	internationalQwenDefaultModelId,
	doubaoModels,
	doubaoDefaultModelId,
	mistralModels,
	mistralDefaultModelId,
	askSageModels,
	askSageDefaultModelId,
	xaiModels,
	xaiDefaultModelId,
	sambanovaModels,
	sambanovaDefaultModelId,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	openAiModelInfoSaneDefaults,
	liteLlmModelInfoSaneDefaults,
} from "@shared/api"
import { formatPrice } from "./format"

export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${uriScheme || "vscode"}://saoudrizwan.claude-dev/openrouter`
}

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
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo,
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
				selectedModelInfo: liteLlmModelInfoSaneDefaults,
			}
		case "xai":
			return getProviderData(xaiModels, xaiDefaultModelId)
		case "sambanova":
			return getProviderData(sambanovaModels, sambanovaDefaultModelId)
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

// Returns an array of formatted tier strings
export const formatTiers = (tiers: ModelInfo["inputPriceTiers"]): string[] => {
	if (!tiers || tiers.length === 0) {
		return []
	}
	return tiers.map((tier, index, arr) => {
		const prevLimit = index > 0 ? arr[index - 1].tokenLimit : 0
		const limitText =
			tier.tokenLimit === Infinity
				? `> ${prevLimit.toLocaleString()}` // Assumes sorted and Infinity is last
				: `<= ${tier.tokenLimit.toLocaleString()}`
		return `${formatPrice(tier.price)}/million tokens (${limitText} tokens)`
	})
}
