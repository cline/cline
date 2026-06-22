import { ResolveModelInfoRequest, ResolveModelInfoResponse } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

export async function resolveModelInfo(
	_controller: ProviderCatalogController,
	_request: ResolveModelInfoRequest,
): Promise<ResolveModelInfoResponse> {
	return ResolveModelInfoResponse.create({})
}
