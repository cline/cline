import type { ModelInfo } from "@shared/api"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Vercel AI Gateway model list through the SDK provider
 * catalog and returns application types.
 *
 * The SDK owns the live fetch of the gateway's /models endpoint (live
 * pricing/context/thinking config) and layers it on top of the bundled
 * catalog — see `@cline/llms` catalog-live-vercel-ai-gateway.
 */
export async function refreshVercelAiGatewayModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("vercel-ai-gateway"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return Object.fromEntries(result.models)
}
