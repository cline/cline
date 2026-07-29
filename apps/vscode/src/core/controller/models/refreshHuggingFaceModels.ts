import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Hugging Face models and returns the updated model list.
 *
 * Model fetching/parsing is consolidated in the SDK: `resolveProviderConfig`
 * merges the curated catalog with the rich live Hugging Face router source
 * (`fetchHuggingFaceLiveModels` in `@cline/core`).
 */
export async function refreshHuggingFaceModels(
	controller: ProviderCatalogController,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const result = await controller.getProviderCatalog().resolveModels(parseProviderId("huggingface"))
	if (!result.ok) {
		throw new Error(result.error.message)
	}
	return OpenRouterCompatibleModelInfo.create({
		models: toProtobufModels(Object.fromEntries(result.models)),
	})
}
