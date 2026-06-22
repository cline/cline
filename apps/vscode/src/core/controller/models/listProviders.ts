import { Empty } from "@/shared/proto/cline/common"
import { ProviderListingsResponse } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

export async function listProviders(_controller: ProviderCatalogController, _request: Empty): Promise<ProviderListingsResponse> {
	return ProviderListingsResponse.create({})
}
