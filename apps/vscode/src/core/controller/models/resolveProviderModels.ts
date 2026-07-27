import { ProviderModelsResponse, ResolveProviderModelsRequest } from "@/shared/proto/cline/models"
import { type ProviderCatalogController, parseProviderIdRequest, toProviderModelsResponse } from "./providerCatalogShared"

export async function resolveProviderModels(
	controller: ProviderCatalogController,
	request: ResolveProviderModelsRequest,
): Promise<ProviderModelsResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const requestId = request.requestId?.trim() || crypto.randomUUID()
	const result = await controller.getProviderCatalog().resolveModels(providerId, { forceRefresh: request.forceRefresh })
	return toProviderModelsResponse(providerId, requestId, result)
}
