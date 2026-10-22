import type { ModelInfo } from "@shared/api"
import { type ProviderCatalogController, resolveProviderModelsRecord } from "./providerCatalogShared"

/**
 * Refreshes the Baseten models and returns application types.
 *
 * Model catalogs are consolidated in the SDK: `resolveProviderConfig` serves
 * the models.dev-backed catalog and, when a Baseten API key is configured,
 * merges in the SDK's authenticated Baseten model fetch — the same source
 * the CLI uses.
 */
export async function refreshBasetenModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	return resolveProviderModelsRecord(controller, "baseten")
}
