import { ProviderConfigResponse, WriteProviderConfigRequest } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

export async function writeProviderConfig(
	_controller: ProviderCatalogController,
	_request: WriteProviderConfigRequest,
): Promise<ProviderConfigResponse> {
	return ProviderConfigResponse.create({})
}
