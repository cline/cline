import type { ApiProvider } from "@shared/api"
import { Empty } from "@/shared/proto/cline/common"
import { CommitModelSelectionRequest } from "@/shared/proto/cline/models"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import {
	hasProviderCatalogStateController,
	type ProviderCatalogController,
	parseModeRequest,
	parseProviderIdRequest,
	toModelSelection,
} from "./providerCatalogShared"

function providerForStorage(providerId: string): ApiProvider {
	return (providerId === "nousresearch" ? "nousResearch" : providerId) as ApiProvider
}

export async function commitModelSelection(
	controller: ProviderCatalogController,
	request: CommitModelSelectionRequest,
): Promise<Empty> {
	const providerId = parseProviderIdRequest(request.providerId)
	const mode = parseModeRequest(request.mode)
	const selection = toModelSelection(request, providerId)
	controller.getProviderConfigStore().commitSelection(providerId, mode, selection)

	if (hasProviderCatalogStateController(controller)) {
		controller.stateManager.setGlobalStateBatch({
			[`${mode}ModeApiProvider`]: providerId,
			[getProviderModelIdKey(providerForStorage(providerId.toString()), mode)]: selection.modelId,
		})
	}

	return Empty.create()
}
