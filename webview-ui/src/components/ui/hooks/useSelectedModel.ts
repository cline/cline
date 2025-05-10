import {
	type ProviderName,
	type ApiConfiguration,
	type RouterModels,
	type ModelInfo,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	mistralDefaultModelId,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
	groqModels,
	groqDefaultModelId,
	chutesModels,
	chutesDefaultModelId,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	glamaDefaultModelId,
	unboundDefaultModelId,
	litellmDefaultModelId,
} from "@roo/shared/api"

import { useRouterModels } from "./useRouterModels"

export const useSelectedModel = (apiConfiguration?: ApiConfiguration) => {
	const { data: routerModels, isLoading, isError } = useRouterModels()
	const provider = apiConfiguration?.apiProvider || "anthropic"

	const { id, info } =
		apiConfiguration && routerModels
			? getSelectedModel({ provider, apiConfiguration, routerModels })
			: { id: anthropicDefaultModelId, info: undefined }

	return { provider, id, info, isLoading, isError }
}

function getSelectedModel({
	provider,
	apiConfiguration,
	routerModels,
}: {
	provider: ProviderName
	apiConfiguration: ApiConfiguration
	routerModels: RouterModels
}): { id: string; info: ModelInfo } {
	switch (provider) {
		case "openrouter": {
			const id = apiConfiguration.openRouterModelId ?? openRouterDefaultModelId
			const info = routerModels.openrouter[id]
			return info
				? { id, info }
				: { id: openRouterDefaultModelId, info: routerModels.openrouter[openRouterDefaultModelId] }
		}
		case "requesty": {
			const id = apiConfiguration.requestyModelId ?? requestyDefaultModelId
			const info = routerModels.requesty[id]
			return info
				? { id, info }
				: { id: requestyDefaultModelId, info: routerModels.requesty[requestyDefaultModelId] }
		}
		case "glama": {
			const id = apiConfiguration.glamaModelId ?? glamaDefaultModelId
			const info = routerModels.glama[id]
			return info ? { id, info } : { id: glamaDefaultModelId, info: routerModels.glama[glamaDefaultModelId] }
		}
		case "unbound": {
			const id = apiConfiguration.unboundModelId ?? unboundDefaultModelId
			const info = routerModels.unbound[id]
			return info
				? { id, info }
				: { id: unboundDefaultModelId, info: routerModels.unbound[unboundDefaultModelId] }
		}
		case "litellm": {
			const id = apiConfiguration.litellmModelId ?? litellmDefaultModelId
			const info = routerModels.litellm[id]
			return info
				? { id, info }
				: { id: litellmDefaultModelId, info: routerModels.litellm[litellmDefaultModelId] }
		}
		case "xai": {
			const id = apiConfiguration.apiModelId ?? xaiDefaultModelId
			const info = xaiModels[id as keyof typeof xaiModels]
			return info ? { id, info } : { id: xaiDefaultModelId, info: xaiModels[xaiDefaultModelId] }
		}
		case "groq": {
			const id = apiConfiguration.apiModelId ?? groqDefaultModelId
			const info = groqModels[id as keyof typeof groqModels]
			return info ? { id, info } : { id: groqDefaultModelId, info: groqModels[groqDefaultModelId] }
		}
		case "chutes": {
			const id = apiConfiguration.apiModelId ?? chutesDefaultModelId
			const info = chutesModels[id as keyof typeof chutesModels]
			return info ? { id, info } : { id: chutesDefaultModelId, info: chutesModels[chutesDefaultModelId] }
		}
		case "bedrock": {
			const id = apiConfiguration.apiModelId ?? bedrockDefaultModelId
			const info = bedrockModels[id as keyof typeof bedrockModels]

			// Special case for custom ARN.
			if (id === "custom-arn") {
				return {
					id,
					info: { maxTokens: 5000, contextWindow: 128_000, supportsPromptCache: false, supportsImages: true },
				}
			}

			return info ? { id, info } : { id: bedrockDefaultModelId, info: bedrockModels[bedrockDefaultModelId] }
		}
		case "vertex": {
			const id = apiConfiguration.apiModelId ?? vertexDefaultModelId
			const info = vertexModels[id as keyof typeof vertexModels]
			return info ? { id, info } : { id: vertexDefaultModelId, info: vertexModels[vertexDefaultModelId] }
		}
		case "gemini": {
			const id = apiConfiguration.apiModelId ?? geminiDefaultModelId
			const info = geminiModels[id as keyof typeof geminiModels]
			return info ? { id, info } : { id: geminiDefaultModelId, info: geminiModels[geminiDefaultModelId] }
		}
		case "deepseek": {
			const id = apiConfiguration.apiModelId ?? deepSeekDefaultModelId
			const info = deepSeekModels[id as keyof typeof deepSeekModels]
			return info ? { id, info } : { id: deepSeekDefaultModelId, info: deepSeekModels[deepSeekDefaultModelId] }
		}
		case "openai-native": {
			const id = apiConfiguration.apiModelId ?? openAiNativeDefaultModelId
			const info = openAiNativeModels[id as keyof typeof openAiNativeModels]
			return info
				? { id, info }
				: { id: openAiNativeDefaultModelId, info: openAiNativeModels[openAiNativeDefaultModelId] }
		}
		case "mistral": {
			const id = apiConfiguration.apiModelId ?? mistralDefaultModelId
			const info = mistralModels[id as keyof typeof mistralModels]
			return info ? { id, info } : { id: mistralDefaultModelId, info: mistralModels[mistralDefaultModelId] }
		}
		case "openai": {
			const id = apiConfiguration.openAiModelId ?? ""
			const info = apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults
			return { id, info }
		}
		case "ollama": {
			const id = apiConfiguration.ollamaModelId ?? ""
			const info = openAiModelInfoSaneDefaults
			return { id, info }
		}
		case "lmstudio": {
			const id = apiConfiguration.lmStudioModelId ?? ""
			const info = openAiModelInfoSaneDefaults
			return { id, info }
		}
		case "vscode-lm": {
			const id = apiConfiguration?.vsCodeLmModelSelector
				? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
				: vscodeLlmDefaultModelId
			const modelFamily = apiConfiguration?.vsCodeLmModelSelector?.family ?? vscodeLlmDefaultModelId
			const info = vscodeLlmModels[modelFamily as keyof typeof vscodeLlmModels]
			return { id, info: { ...openAiModelInfoSaneDefaults, ...info, supportsImages: false } } // VSCode LM API currently doesn't support images.
		}
		// case "anthropic":
		// case "human-relay":
		// case "fake-ai":
		default: {
			const id = apiConfiguration.apiModelId ?? anthropicDefaultModelId
			const info = anthropicModels[id as keyof typeof anthropicModels]
			return info ? { id, info } : { id: anthropicDefaultModelId, info: anthropicModels[anthropicDefaultModelId] }
		}
	}
}
