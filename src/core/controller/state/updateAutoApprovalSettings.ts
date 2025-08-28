import { Empty } from "@shared/proto/cline/common"
import { AutoApprovalSettingsRequest } from "@shared/proto/cline/state"
import { convertProtoToAutoApprovalSettings } from "../../../shared/proto-conversions/models/auto-approval-settings-conversion"
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
		const settings = convertProtoToAutoApprovalSettings(request)

		controller.stateManager.setGlobalState("autoApprovalSettings", settings)

		if (controller.task) {
			controller.task.updateAutoApprovalSettings(settings)
		}

		await controller.postStateToWebview()
	}

	return Empty.create()
}
