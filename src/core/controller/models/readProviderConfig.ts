import { StringRequest } from "@/shared/proto/cline/common"
import { ProviderConfigResponse } from "@/shared/proto/cline/models"
import { type ProviderCatalogController, parseProviderIdRequest, toRedactedProviderConfigResponse } from "./providerCatalogShared"

export async function readProviderConfig(
	controller: ProviderCatalogController,
	request: StringRequest,
): Promise<ProviderConfigResponse> {
	const providerId = parseProviderIdRequest(request.value, "value")
	return toRedactedProviderConfigResponse(controller.getProviderConfigStore().read(providerId))
}
