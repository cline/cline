import { syncLastUsedProviderFromState } from "@/sdk/provider-state-reconciliation"
import { ProviderConfigResponse, WriteProviderConfigRequest } from "@/shared/proto/cline/models"
import {
	type ProviderCatalogController,
	parseProviderIdRequest,
	toProviderConfigPatch,
	toRedactedProviderConfigResponse,
} from "./providerCatalogShared"

export async function writeProviderConfig(
	controller: ProviderCatalogController,
	request: WriteProviderConfigRequest,
): Promise<ProviderConfigResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const store = controller.getProviderConfigStore()
	const updated = store.write(providerId, toProviderConfigPatch(request.patch))
	// This write can be the one that first gives the selected provider an entry
	// in providers.json, which is what `syncLastUsedProvider` waits for before
	// moving the pointer.
	syncLastUsedProviderFromState()
	return toRedactedProviderConfigResponse(updated, store)
}
