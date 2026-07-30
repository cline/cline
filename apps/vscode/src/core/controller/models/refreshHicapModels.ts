import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import { type ProviderCatalogController, resolveProviderModelsRecord } from "./providerCatalogShared"

/**
 * Refreshes the Hicap models and returns the updated model list.
 *
 * Model catalogs are consolidated in the SDK: `resolveProviderConfig` serves
 * the models.dev-backed catalog and, when a Hicap API key is configured,
 * merges in the SDK's authenticated Hicap model fetch — the same source the
 * CLI uses.
 */
export async function refreshHicapModels(
	controller: ProviderCatalogController,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const models = await resolveProviderModelsRecord(controller, "hicap")
	return OpenRouterCompatibleModelInfo.create({ models: toProtobufModels(models) })
}
