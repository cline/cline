import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Groq model list through the SDK provider catalog and
 * returns application types.
 *
 * The SDK owns the authenticated live fetch of Groq's /models endpoint and
 * enriches it from the curated catalog (see `@cline/llms`
 * catalog-live-groq + `@cline/core` private provider model fetchers).
 * Without an API key — or when the live fetch fails — the bundled curated
 * catalog is returned instead.
 */
export async function refreshGroqModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("groq"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
