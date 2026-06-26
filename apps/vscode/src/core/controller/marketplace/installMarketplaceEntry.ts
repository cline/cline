import { type MarketplaceEntryRequest, MarketplaceInstallResult } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { installMarketplaceEntryFromCatalog } from "./marketplace-helpers"

export async function installMarketplaceEntry(
	controller: Controller,
	request: MarketplaceEntryRequest,
): Promise<MarketplaceInstallResult> {
	if (!request.entry) {
		throw new Error("Marketplace entry is required.")
	}
	const result = await installMarketplaceEntryFromCatalog(request.entry)
	if (request.entry.type === "skill" || request.entry.type === "plugin") {
		await controller.invalidateUserInstructionService()
	}
	return result
}
