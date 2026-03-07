import { BannerService } from "@/services/banner/BannerService"
import type { StringRequest } from "@/shared/proto/cline/common"
import { Empty } from "@/shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Dismisses a banner and sends telemetry
 * @param controller The controller instance
 * @param request The request containing the banner ID to dismiss
 * @returns Empty response
 */
export async function dismissBanner(controller: Controller, request: StringRequest): Promise<Empty> {
	const bannerId = request.value

	if (!bannerId) {
		return {}
	}
	try {
		await BannerService.get().dismissBanner(bannerId)
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("Failed to dismiss banner:", error)
	}
	return {}
}
