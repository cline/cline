import { MarketplaceStarRequest, MarketplaceStarResponse } from "@shared/proto/cline/common"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"

export async function starSkill(_controller: Controller, request: MarketplaceStarRequest): Promise<MarketplaceStarResponse> {
	const itemId = request.itemId
	try {
		const result = await MarketplaceRecognitionService.setStar("skills", itemId, request.starred)
		return MarketplaceStarResponse.create({
			marketplace: "skills",
			itemId,
			starred: result.starred,
			aiHydroStars: result.aiHydroStars,
		})
	} catch (error) {
		return MarketplaceStarResponse.create({
			marketplace: "skills",
			itemId,
			starred: !request.starred,
			aiHydroStars: 0,
			error: error instanceof Error ? error.message : "AI-Hydro star update failed",
		})
	}
}
