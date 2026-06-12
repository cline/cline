import { MarketplaceStarRequest, MarketplaceStarResponse } from "@shared/proto/cline/common"
import { MarketplaceRecognitionService, type RecognitionMarketplace } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"

export async function starModule(_controller: Controller, request: MarketplaceStarRequest): Promise<MarketplaceStarResponse> {
	const itemId = request.itemId
	// Honor the marketplace on the request (e.g. "courses") so the same handler
	// serves modules and courses; default to "modules" for back-compat.
	const marketplace = (request.marketplace || "modules") as RecognitionMarketplace
	try {
		const result = await MarketplaceRecognitionService.setStar(marketplace, itemId, request.starred)
		return MarketplaceStarResponse.create({
			marketplace,
			itemId,
			starred: result.starred,
			aiHydroStars: result.aiHydroStars,
		})
	} catch (error) {
		return MarketplaceStarResponse.create({
			marketplace,
			itemId,
			starred: !request.starred,
			aiHydroStars: 0,
			error: error instanceof Error ? error.message : "AI-Hydro star update failed",
		})
	}
}
