import type { EmptyRequest } from "@shared/proto/cline/common"
import { MarketplaceCatalog } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { fetchMarketplaceCatalog } from "./marketplace-helpers"
import { filterMarketplaceEntriesByPolicy } from "./marketplace-policy"

export async function getMarketplaceCatalog(controller: Controller, _request: EmptyRequest): Promise<MarketplaceCatalog> {
	// Enterprise MCP policy must be known before serving the catalog, otherwise
	// a webview opened right after activation would briefly see the unfiltered list.
	await controller.waitForInitialRemoteConfig()
	const catalog = await fetchMarketplaceCatalog()
	return MarketplaceCatalog.create({
		entries: filterMarketplaceEntriesByPolicy(catalog.entries, controller.stateManager.getRemoteConfigSettings()),
	})
}
