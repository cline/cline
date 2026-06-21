import { StringRequest } from "@/shared/proto/cline/common"
import { ProviderConfigResponse } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

export async function readProviderConfig(
	_controller: ProviderCatalogController,
	_request: StringRequest,
): Promise<ProviderConfigResponse> {
	return ProviderConfigResponse.create({})
}
