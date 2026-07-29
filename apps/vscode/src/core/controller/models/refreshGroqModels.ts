import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Groq models and returns application types.
 *
 * Model fetching/parsing is consolidated in the SDK: when a Groq API key is
 * configured, `resolveProviderConfig` live-fetches Groq's models endpoint
 * (`fetchGroqPrivateModels` in `@cline/core`) and enriches each model with
 * curated pricing/capabilities; without a key the curated catalog is served.
 */
export async function refreshGroqModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("groq"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
