import { Empty } from "@shared/proto/cline/common"
import { AutoApprovalSettingsRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

/**
 * Updates the auto approval settings
 * @param controller The controller instance
 * @param request The auto approval settings request
 * @returns Empty response
 */
export async function updateAutoApprovalSettings(controller: Controller, request: AutoApprovalSettingsRequest): Promise<Empty> {
	const currentSettings = (await controller.getStateToPostToWebview()).autoApprovalSettings
	const incomingVersion = request.version
	const currentVersion = currentSettings?.version ?? 1

	// Only update if incoming version is higher
	if (incomingVersion > currentVersion) {
		// Merge with current settings to preserve unspecified fields
		const settings = {
			...currentSettings,
			...(request.version !== undefined && { version: request.version }),
			...(request.enabled !== undefined && { enabled: request.enabled }),
			...(request.maxRequests !== undefined && { maxRequests: request.maxRequests }),
			...(request.enableNotifications !== undefined && { enableNotifications: request.enableNotifications }),
			...(request.favorites && request.favorites.length > 0 && { favorites: request.favorites }),
			actions: {
				...currentSettings.actions,
				...(request.actions
					? Object.fromEntries(Object.entries(request.actions).filter(([_, v]) => v !== undefined))
					: {}),
			},
		}

		if (controller.task) {
			const maxRequestsChanged =
				controller.stateManager.getGlobalSettingsKey("autoApprovalSettings").maxRequests !== settings.maxRequests

			// Reset counter if max requests limit changed
			if (maxRequestsChanged) {
				controller.task.resetConsecutiveAutoApprovedRequestsCount()
			}
		}

		controller.stateManager.setGlobalState("autoApprovalSettings", settings)

		await controller.postStateToWebview()
	}

	return Empty.create()
}
