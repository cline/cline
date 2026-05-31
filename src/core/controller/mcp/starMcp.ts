import { MarketplaceStarRequest, MarketplaceStarResponse } from "@shared/proto/cline/common"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"

export async function starMcp(_controller: Controller, request: MarketplaceStarRequest): Promise<MarketplaceStarResponse> {
	const itemId = request.itemId
	try {
		const result = await MarketplaceRecognitionService.setStar("mcp", itemId, request.starred)
		return MarketplaceStarResponse.create({
			marketplace: "mcp",
			itemId,
			starred: result.starred,
			aiHydroStars: result.aiHydroStars,
		})
	} catch (error) {
		return MarketplaceStarResponse.create({
			marketplace: "mcp",
			itemId,
			starred: !request.starred,
			aiHydroStars: 0,
			error: error instanceof Error ? error.message : "AI-Hydro star update failed",
		})
	}
}
