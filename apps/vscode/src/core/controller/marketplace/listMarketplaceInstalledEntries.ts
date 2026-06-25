import type { MarketplaceEntriesRequest, MarketplaceInstalledEntries } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { listInstalledMarketplaceEntries } from "./marketplace-helpers"

export async function listMarketplaceInstalledEntries(
	controller: Controller,
	request: MarketplaceEntriesRequest,
): Promise<MarketplaceInstalledEntries> {
	return listInstalledMarketplaceEntries(controller, request.entries)
}
