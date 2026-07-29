import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Vercel AI Gateway models and returns application types.
 *
 * Model fetching/parsing is consolidated in the SDK: `resolveProviderConfig`
 * merges the curated catalog with the rich live Vercel AI Gateway source
 * (`fetchVercelAiGatewayLiveModels` in `@cline/core`), which parses live
 * pricing/context/thinking config.
 */
export async function refreshVercelAiGatewayModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("vercel-ai-gateway"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
