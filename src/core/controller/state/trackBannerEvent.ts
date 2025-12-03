import { Empty } from "@/shared/proto/cline/common"
import type { TrackBannerEventRequest } from "@/shared/proto/cline/state"
import type { Controller } from ".."

/**
 * Tracks a banner event (e.g., dismiss, click)
 * @param controller The controller instance
 * @param request The request containing banner ID and event type
 * @returns Empty response
 */
export async function trackBannerEvent(controller: Controller, request: TrackBannerEventRequest): Promise<Empty> {
	const { bannerId, eventType } = request

	if (bannerId && eventType) {
		await controller.trackBannerEvent(bannerId, eventType as "dismiss")
	}

	return Empty.create()
}
