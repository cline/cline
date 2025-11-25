import type { TrackBannerEventRequest } from "@/shared/proto/cline/banners"
import { Empty } from "@/shared/proto/cline/common"
import type { Controller } from ".."

/**
 * Tracks a banner event (seen, dismiss, click)
 * @param controller The controller instance
 * @param request The request containing banner ID and event type
 * @returns Empty response
 */
export async function TrackBannerEvent(controller: Controller, request: TrackBannerEventRequest): Promise<Empty> {
	try {
		// Currently only "dismiss" is supported in the backend
		if (request.eventType === "dismiss") {
			await controller.trackBannerEvent(request.bannerId, "dismiss")
		}
		return Empty.create({})
	} catch (error) {
		console.error("Failed to track banner event:", error)
		return Empty.create({})
	}
}
