import { type MarketplaceEntryRequest, MarketplaceInstallResult } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { installMarketplaceEntryFromCatalog } from "./marketplace-helpers"
import { isMarketplaceEntryAllowedByPolicy } from "./marketplace-policy"

export async function installMarketplaceEntry(
	controller: Controller,
	request: MarketplaceEntryRequest,
): Promise<MarketplaceInstallResult> {
	if (!request.entry) {
		throw new Error("Marketplace entry is required.")
	}
	if (!isMarketplaceEntryAllowedByPolicy(request.entry, controller.stateManager.getRemoteConfigSettings())) {
		throw new Error("Installing this MCP server is not allowed by your organization's policy.")
	}
	const result = await installMarketplaceEntryFromCatalog(request.entry)
	if (request.entry.type === "mcp") {
		await controller.mcpHub?.reconcileMcpServersFromSettingsRPC()
	}
	if (request.entry.type === "skill" || request.entry.type === "plugin") {
		await controller.invalidateUserInstructionService()
	}
	return result
}
