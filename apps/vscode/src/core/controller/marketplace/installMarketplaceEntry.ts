import { type MarketplaceEntryRequest, MarketplaceInstallResult } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { installMarketplaceEntryFromCatalog, isMcpEntryAllowedByPolicy } from "./marketplace-helpers"

export async function installMarketplaceEntry(
	controller: Controller,
	request: MarketplaceEntryRequest,
): Promise<MarketplaceInstallResult> {
	if (!request.entry) {
		throw new Error("Marketplace entry is required.")
	}
	if (!isMcpEntryAllowedByPolicy(request.entry, controller.stateManager.getRemoteConfigSettings())) {
		throw new Error(
			`Installing "${request.entry.name || request.entry.id}" is blocked by your organization's MCP server policy.`,
		)
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
