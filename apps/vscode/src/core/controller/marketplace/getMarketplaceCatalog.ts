import type { EmptyRequest } from "@shared/proto/cline/common"
import type { MarketplaceCatalog } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { fetchMarketplaceCatalog } from "./marketplace-helpers"
import { filterMarketplaceCatalogByPolicy } from "./mcp-marketplace-policy"

export async function getMarketplaceCatalog(controller: Controller, _request: EmptyRequest): Promise<MarketplaceCatalog> {
	const catalog = await fetchMarketplaceCatalog()
	// Enterprise remote config can disable the MCP marketplace or restrict it
	// to an allowlist of approved servers. Filter server-side so blocked
	// entries never reach the webview.
	return filterMarketplaceCatalogByPolicy(catalog, controller.stateManager.getRemoteConfigSettings())
}
