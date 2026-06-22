import { ProviderModelsResponse, ResolveProviderModelsRequest } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

export async function resolveProviderModels(
	_controller: ProviderCatalogController,
	_request: ResolveProviderModelsRequest,
): Promise<ProviderModelsResponse> {
	return ProviderModelsResponse.create({})
}
