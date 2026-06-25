import { MarketplaceInstallResult, type MarketplaceEntryRequest } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { installMarketplaceEntryWithCli } from "./marketplace-helpers"

export async function installMarketplaceEntry(
	_controller: Controller,
	request: MarketplaceEntryRequest,
): Promise<MarketplaceInstallResult> {
	if (!request.entry) {
		throw new Error("Marketplace entry is required.")
	}
	return installMarketplaceEntryWithCli(request.entry)
}
