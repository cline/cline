import type { EmptyRequest, Boolean } from "../../../shared/proto/common"
import type { Controller } from "../index"
import { getGlobalState, updateGlobalState } from "../../storage/state"

/**
 * Marks the current announcement as shown and returns the updated shouldShowAnnouncement value
 *
 * @param controller The controller instance
 * @param _request The empty request (not used)
 * @returns Boolean indicating whether an announcement should be shown
 */
export async function onDidShowAnnouncement(controller: Controller, _request: EmptyRequest): Promise<Boolean> {
	try {
		// Update the lastShownAnnouncementId to the current latestAnnouncementId
		await updateGlobalState(controller.context, "lastShownAnnouncementId", controller.latestAnnouncementId)

		// Get the updated lastShownAnnouncementId value after the update
		const lastShownAnnouncementId = await getGlobalState(controller.context, "lastShownAnnouncementId")

		// Calculate the new shouldShowAnnouncement value
		// This replicates the same logic used in getStateToPostToWebview()
		const shouldShowAnnouncement = lastShownAnnouncementId !== controller.latestAnnouncementId

		return { value: shouldShowAnnouncement }
	} catch (error) {
		console.error("Failed to acknowledge announcement:", error)
		return { value: false }
	}
}
