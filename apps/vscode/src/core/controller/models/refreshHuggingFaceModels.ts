import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import type { ProviderCatalogController } from "./providerCatalogShared"

/**
 * Refreshes the Hugging Face models and returns the updated model list.
 *
 * Model catalogs are consolidated in the SDK: this resolves through the
 * models.dev-backed catalog (bundled + live refresh) via
 * `resolveProviderConfig`, the same source the CLI uses.
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
