import { Empty, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Updates the info banner version to track which version the user has dismissed
 * @param controller The controller instance
 * @param request The request containing the version number
 * @returns Empty response
 */
export async function updateInfoBannerVersion(controller: Controller, request: Int64Request): Promise<Empty> {
	const version = Number(request.value)

	controller.stateManager.setGlobalState("lastDismissedInfoBannerVersion", version)
	await controller.postStateToWebview()

	return Empty.create()
}
