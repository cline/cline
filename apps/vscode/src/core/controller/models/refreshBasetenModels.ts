import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Baseten models and returns application types.
 *
 * Model catalogs are consolidated in the SDK: `resolveProviderConfig` serves
 * the models.dev-backed catalog and, when a Baseten API key is configured,
 * merges in the SDK's authenticated Baseten model fetch — the same source
 * the CLI uses.
 */
export async function refreshBasetenModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("baseten"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
