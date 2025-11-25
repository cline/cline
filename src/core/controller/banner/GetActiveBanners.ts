import type { BannersResponse } from "@/shared/proto/cline/banners"
import { Banner } from "@/shared/proto/cline/banners"
import type { Controller } from ".."

/**
 * Gets active banners that haven't been dismissed
 * @param controller The controller instance
 * @returns BannersResponse with active banners
 */
export async function GetActiveBanners(controller: Controller): Promise<BannersResponse> {
	try {
		const banners = await controller.fetchBannersForDisplay()

		const protoBanners = banners.map((banner) =>
			Banner.create({
				id: banner.id,
				titleMd: banner.titleMd,
				bodyMd: banner.bodyMd,
				severity: banner.severity,
				placement: banner.placement,
				ctaText: banner.ctaText,
				ctaUrl: banner.ctaUrl,
				activeFrom: banner.activeFrom,
				activeTo: banner.activeTo,
				rulesJson: banner.rulesJson,
			}),
		)

		return {
			banners: protoBanners,
		}
	} catch (error) {
		console.error("Failed to get active banners:", error)
		return {
			banners: [],
		}
	}
}
