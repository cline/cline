import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the OpenRouter model list through the SDK provider catalog and
 * returns application types.
 *
 * The SDK owns the live fetch of OpenRouter's /models endpoint (rich
 * pricing/capability parsing, curated overrides, stealth models) and layers
 * it on top of the bundled catalog — see `@cline/llms`
 * catalog-live-openrouter. This keeps the settings picker on the exact same
 * model metadata the task header and auto-compaction resolve through
 * `resolveModelInfo` (ENG-2381/ENG-2345), for all SDK clients including the
 * CLI. Caching/deduping is handled by the catalog.
 */
export async function refreshOpenRouterModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("openrouter"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
