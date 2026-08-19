import type { EmptyRequest } from "@shared/proto/cline/common"
import type { MarketplaceCatalog } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { fetchMarketplaceCatalog } from "./marketplace-helpers"

export async function getMarketplaceCatalog(_controller: Controller, _request: EmptyRequest): Promise<MarketplaceCatalog> {
	return fetchMarketplaceCatalog()
}
