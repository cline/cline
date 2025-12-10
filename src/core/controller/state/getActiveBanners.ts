import { BannerService } from "@/services/banner/BannerService"
import type { StringRequest } from "@/shared/proto/cline/common"
import { String as ProtoString } from "@/shared/proto/cline/common"
import type { Controller } from ".."

/**
 * Gets active banners from the banner service
 * @param controller The controller instance
 * @param request The request with forceRefresh flag as string ("true" or "false")
 * @returns JSON string of active banners
 */
export async function getActiveBanners(controller: Controller, request: StringRequest): Promise<ProtoString> {
	try {
		const forceRefresh = request.value === "true"

		// Get banner service instance
		const bannerService = BannerService.get()

		// Fetch non-dismissed banners
		const banners = await bannerService.getNonDismissedBanners(forceRefresh)

		// Return as JSON string
		return ProtoString.create({
			value: JSON.stringify(banners),
		})
	} catch (error) {
		// Return empty array on error
		console.error("Failed to get active banners:", error)
		return ProtoString.create({
			value: JSON.stringify([]),
		})
	}
}
