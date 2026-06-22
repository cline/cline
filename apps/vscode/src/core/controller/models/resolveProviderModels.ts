import { type ModelInfo as SdkModelInfo, getModelsForProvider, getProviderCollection } from "@cline/llms"
import { OpenRouterModelInfo, ProviderModelsResponse, ResolveProviderModelsRequest } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

/**
 * Translate an SDK catalog ModelInfo (capabilities array + nested pricing /
 * thinking config) into the flat proto OpenRouterModelInfo shape the webview
 * consumes.
 */
function toProtoModelInfo(model: SdkModelInfo): OpenRouterModelInfo {
	const capabilities = new Set(model.capabilities ?? [])
	return OpenRouterModelInfo.create({
		maxTokens: model.maxTokens,
		contextWindow: model.contextWindow,
		supportsImages: capabilities.has("images"),
		supportsPromptCache: capabilities.has("prompt-cache"),
		inputPrice: model.pricing?.input,
		outputPrice: model.pricing?.output,
		cacheWritesPrice: model.pricing?.cacheWrite,
		cacheReadsPrice: model.pricing?.cacheRead,
		description: model.description,
		thinkingConfig: model.thinkingConfig
			? {
					maxBudget: model.thinkingConfig.maxBudget,
					outputPrice: model.thinkingConfig.outputPrice,
					outputPriceTiers: [],
				}
			: undefined,
		supportsGlobalEndpoint: capabilities.has("global-endpoint") || undefined,
		tiers: [],
		name: model.name,
		temperature: model.temperature,
		supportsReasoning: capabilities.has("reasoning") || undefined,
	})
}

/**
 * Resolve the model catalog for the requested provider from the SDK catalog
 * and map it into the proto response. Models are sourced statically from the
 * built-in catalog (plus any registered custom models); dynamic/network
 * refresh is not performed here.
 */
export async function resolveProviderModels(
	_controller: ProviderCatalogController,
	request: ResolveProviderModelsRequest,
): Promise<ProviderModelsResponse> {
	const providerId = request.providerId
	const requestId = request.requestId ?? ""

	const collection = await getProviderCollection(providerId)
	if (!collection) {
		return ProviderModelsResponse.create({
			providerId,
			requestId,
			ok: false,
			fetchedAt: Date.now(),
			error: {
				kind: "not_found",
				message: `Unknown provider: ${providerId}`,
				retryable: false,
			},
		})
	}

	const sdkModels = await getModelsForProvider(providerId)
	const models: { [key: string]: OpenRouterModelInfo } = {}
	for (const [modelId, info] of Object.entries(sdkModels)) {
		models[modelId] = toProtoModelInfo(info)
	}

	const defaultModelId =
		collection.provider.defaultModelId && models[collection.provider.defaultModelId]
			? collection.provider.defaultModelId
			: Object.keys(models)[0]

	return ProviderModelsResponse.create({
		providerId,
		requestId,
		ok: true,
		fetchedAt: Date.now(),
		models,
		defaultModelId: defaultModelId || undefined,
		source: "sdk-catalog",
	})
}
