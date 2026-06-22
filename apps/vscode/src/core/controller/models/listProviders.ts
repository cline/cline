import { getAllProviders, resolveProviderUsageCostDisplay } from "@cline/llms"
import { Empty } from "@/shared/proto/cline/common"
import { ProviderListing, ProviderListingsResponse } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

// Providers whose model id is user-supplied free text rather than a fixed
// catalog selection (bring-your-own base URL + model, or host-fetched lists
// that the user can bypass). For these the picker must allow arbitrary ids.
const CUSTOM_MODEL_ID_PROVIDER_IDS = new Set(["openai-compatible", "openai", "ollama", "lmstudio", "litellm"])

/**
 * Lists the providers available in the SDK catalog for the top-level
 * model/provider picker. The full per-provider model list is intentionally
 * omitted here; consumers call resolveProviderModels for models.
 */
export async function listProviders(_controller: ProviderCatalogController, _request: Empty): Promise<ProviderListingsResponse> {
	const providers = await getAllProviders()

	const listings: ProviderListing[] = providers.map((provider) =>
		ProviderListing.create({
			id: provider.id,
			name: provider.name,
			defaultModelId: provider.defaultModelId || undefined,
			protocol: provider.protocol,
			authDescription: provider.description || undefined,
			allowsCustomModelIds: CUSTOM_MODEL_ID_PROVIDER_IDS.has(provider.id),
			usageCostDisplay: resolveProviderUsageCostDisplay(provider.id) === "hide" ? "hide" : "show",
		}),
	)

	return ProviderListingsResponse.create({ providers: listings })
}
