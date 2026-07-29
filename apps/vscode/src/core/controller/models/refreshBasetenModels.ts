import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Baseten model list through the SDK provider catalog and
 * returns application types.
 *
 * The SDK owns the authenticated live fetch of Baseten's /models endpoint
 * (live pricing + reasoning support) and enriches it from the curated
 * catalog (see `@cline/llms` catalog-live-baseten + `@cline/core` private
 * provider model fetchers). Without an API key — or when the live fetch
 * fails — the bundled curated catalog is returned instead.
 */
export async function refreshBasetenModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("baseten"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
