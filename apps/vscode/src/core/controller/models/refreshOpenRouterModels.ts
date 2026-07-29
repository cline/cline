import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the OpenRouter models and returns application types.
 *
 * Model fetching/parsing is consolidated in the SDK: `resolveProviderConfig`
 * merges the curated catalog with the rich live OpenRouter source
 * (`fetchOpenRouterLiveModels` in `@cline/core`), which carries pricing incl.
 * cache read/write, descriptions, image support, thinking config, tiers, and
 * curated overrides. The `cline` provider's model list piggybacks on the same
 * OpenRouter catalog key, so both stay consistent with the task header and
 * auto-compaction (which resolve through the same catalog).
 */
export async function refreshOpenRouterModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("openrouter"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
