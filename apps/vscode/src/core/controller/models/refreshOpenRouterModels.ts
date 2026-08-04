import type { ModelInfo } from "@shared/api"
import { type ProviderCatalogController, resolveProviderModelsRecord } from "./providerCatalogShared"

/**
 * Refreshes the OpenRouter models and returns application types.
 *
 * Model catalogs are consolidated in the SDK: this resolves through the
 * models.dev-backed catalog (bundled + live refresh) via
 * `resolveProviderConfig`, the same source the CLI uses. The `cline`
 * provider piggybacks on the same OpenRouter catalog key, and the task
 * header / auto-compaction resolve through the same catalog, so all
 * surfaces stay consistent.
 */
export async function refreshOpenRouterModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	return resolveProviderModelsRecord(controller, "openrouter")
}
