import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Requesty models and returns the updated model list.
 *
 * Model fetching/parsing is consolidated in the SDK: when a Requesty API key
 * is configured, `resolveProviderConfig` live-fetches the configured Requesty
 * router's models endpoint (`fetchRequestyPrivateModels` in `@cline/core`)
 * with pricing, vision, and caching metadata.
 */
export async function refreshRequestyModels(
	controller: ProviderCatalogController,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("requesty"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return OpenRouterCompatibleModelInfo.create({
		models: toProtobufModels(Object.fromEntries(result.models)),
	})
}
