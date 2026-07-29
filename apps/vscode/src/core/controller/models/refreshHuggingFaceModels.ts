import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Hugging Face model list through the SDK provider catalog.
 *
 * The SDK owns the live fetch of the Hugging Face router's /models endpoint
 * (currently routable models, enriched from the curated catalog) and layers
 * it on top of the bundled catalog — see `@cline/llms`
 * catalog-live-huggingface.
 *
 * @param controller The controller instance
 * @param _request Empty request object
 * @returns Response containing the Hugging Face models (protobuf types)
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
