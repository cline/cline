import type { EmptyRequest } from "@shared/proto/cline/common"
import { Boolean } from "@shared/proto/cline/common"
import { getLatestAnnouncementId } from "@/utils/announcements"
import type { Controller } from "../index"

/**
 * Marks the current announcement as shown
 *
 * @param controller The controller instance
 * @param _request The empty request (not used)
 * @returns Boolean indicating announcement should no longer be shown
 */
export async function onDidShowAnnouncement(controller: Controller, _request: EmptyRequest): Promise<Boolean> {
	try {
		const latestAnnouncementId = getLatestAnnouncementId()
		// Update the lastShownAnnouncementId to the current latestAnnouncementId
		controller.stateManager.setGlobalState("lastShownAnnouncementId", latestAnnouncementId)
		return Boolean.create({ value: false })
	} catch (error) {
		console.error("Failed to acknowledge announcement:", error)
		return Boolean.create({ value: false })
	}
}
