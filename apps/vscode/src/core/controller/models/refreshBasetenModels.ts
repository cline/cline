import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Baseten models and returns application types.
 *
 * Model fetching/parsing is consolidated in the SDK: when a Baseten API key
 * is configured, `resolveProviderConfig` live-fetches Baseten's models
 * endpoint (`fetchBasetenPrivateModels` in `@cline/core`) with live pricing,
 * token limits, and reasoning support, enriched from the curated catalog;
 * without a key the curated catalog is served.
 */
export async function refreshBasetenModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("baseten"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
