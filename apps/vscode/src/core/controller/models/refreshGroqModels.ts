import type { ModelInfo } from "@shared/api"
import { type ProviderCatalogController, resolveProviderModelsRecord } from "./providerCatalogShared"

/**
 * Refreshes the Groq models and returns application types.
 *
 * Model catalogs are consolidated in the SDK: this resolves through the
 * models.dev-backed catalog (bundled + live refresh) via
 * `resolveProviderConfig`, the same source the CLI uses.
 */
export async function refreshGroqModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	return resolveProviderModelsRecord(controller, "groq")
}
