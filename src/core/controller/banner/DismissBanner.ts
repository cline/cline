import type { DismissBannerRequest } from "@/shared/proto/cline/banners"
import { Empty } from "@/shared/proto/cline/common"
import type { Controller } from ".."

/**
 * Dismisses a banner
 * @param controller The controller instance
 * @param request The request containing the banner ID to dismiss
 * @returns Empty response
 */
export async function DismissBanner(controller: Controller, request: DismissBannerRequest): Promise<Empty> {
	try {
		await controller.dismissBanner(request.bannerId)
		return Empty.create({})
	} catch (error) {
		console.error("Failed to dismiss banner:", error)
		return Empty.create({})
	}
}
