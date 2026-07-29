import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Hicap model list through the SDK provider catalog.
 *
 * The SDK owns the authenticated live fetch of Hicap's /models endpoint
 * (see `@cline/core`'s private provider model fetchers). Without an API
 * key the bundled catalog is returned instead.
 *
 * @param controller The controller instance
 * @param _request Empty request object
 * @returns Response containing the Hicap models (protobuf types)
 */
export async function refreshHicapModels(
	controller: ProviderCatalogController,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("hicap"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return OpenRouterCompatibleModelInfo.create({
		models: toProtobufModels(Object.fromEntries(result.models)),
	})
}
