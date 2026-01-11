import { BannerService } from "@/services/banner/BannerService"
import { Empty } from "@/shared/proto/cline/common"
import type { TrackBannerEventRequest } from "@/shared/proto/cline/state"
import type { Controller } from ".."

/**
 * Tracks a banner event (e.g., dismiss, click)
 * @param controller The controller instance
 * @param request The request containing banner ID and event type
 * @returns Empty response
 */
export async function trackBannerEvent(_controller: Controller, request: TrackBannerEventRequest): Promise<Empty> {
	const { bannerId, eventType } = request
	if (!bannerId) {
		return {}
	}
	if (eventType !== "dismiss") {
		console.error("Unsupported event type ", eventType)
		return {}
	}
	try {
		await BannerService.get().sendBannerEvent(bannerId, eventType)
	} catch (error) {
		console.error("Failed to track banner event:", error)
	}
	return {}
}
