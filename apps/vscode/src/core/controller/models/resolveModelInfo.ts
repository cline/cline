import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { adaptSdkModelInfo } from "@/sdk/model-catalog/shape-adapter"
import { ResolveModelInfoRequest, ResolveModelInfoResponse } from "@/shared/proto/cline/models"
import { toProtobufModelInfo } from "@/shared/proto-conversions/models/typeConversion"
import { type ProviderCatalogController, parseProviderIdRequest } from "./providerCatalogShared"

// Intentionally async for the generated gRPC handler contract. The body is
// synchronous in effect: do not add awaits, model-list refreshes, or cache/store
// mutations to this chat/status metadata path.
export async function resolveModelInfo(
	controller: ProviderCatalogController,
	request: ResolveModelInfoRequest,
): Promise<ResolveModelInfoResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const requestedModelId = request.modelId?.trim() || ""

	if (requestedModelId) {
		const store = controller.getProviderConfigStore()
		const actSelection = store.readSelection(providerId, "act")
		if (actSelection?.modelId === requestedModelId) {
			return ResolveModelInfoResponse.create({
				providerId,
				modelId: actSelection.modelId,
				modelInfo: toProtobufModelInfo(actSelection.modelInfo),
				source: "committed-selection",
			})
		}

		const planSelection = store.readSelection(providerId, "plan")
		if (planSelection?.modelId === requestedModelId) {
			return ResolveModelInfoResponse.create({
				providerId,
				modelId: planSelection.modelId,
				modelInfo: toProtobufModelInfo(planSelection.modelInfo),
				source: "committed-selection",
			})
		}
	}

	const collection = MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]
	const generatedModels = getGeneratedModelsForProvider(providerId)
	const requestedModelInfo = requestedModelId
		? (generatedModels[requestedModelId] ?? collection?.models?.[requestedModelId])
		: undefined
	if (requestedModelId && requestedModelInfo) {
		return ResolveModelInfoResponse.create({
			providerId,
			modelId: requestedModelId,
			modelInfo: toProtobufModelInfo(adaptSdkModelInfo(requestedModelInfo)),
			source: "sdk-known-models",
		})
	}

	const defaultModelId = collection?.provider?.defaultModelId?.trim() || Object.keys(generatedModels)[0] || ""
	const defaultModelInfo = defaultModelId
		? (generatedModels[defaultModelId] ?? collection?.models?.[defaultModelId])
		: undefined
	if (defaultModelId && defaultModelInfo) {
		return ResolveModelInfoResponse.create({
			providerId,
			modelId: defaultModelId,
			modelInfo: toProtobufModelInfo(adaptSdkModelInfo(defaultModelInfo)),
			source: "sdk-default",
		})
	}

	return ResolveModelInfoResponse.create({
		providerId,
		modelId: requestedModelId,
		source: "unknown",
	})
}
