import { Empty } from "@/shared/proto/cline/common"
import { ProviderListingsResponse } from "@/shared/proto/cline/models"
import { type ProviderCatalogController, toProviderListingProto } from "./providerCatalogShared"

export async function listProviders(controller: ProviderCatalogController, _request: Empty): Promise<ProviderListingsResponse> {
	const providers = await controller.getProviderCatalog().listProviders()
	return ProviderListingsResponse.create({
		providers: providers.map(toProviderListingProto),
	})
}
