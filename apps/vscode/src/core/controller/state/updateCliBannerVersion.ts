import { Empty, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Updates the CLI banner version to hide it
 * @param controller The controller instance
 * @param request The request containing the version number
 * @returns Empty response
 */
export async function updateCliBannerVersion(controller: Controller, request: Int64Request): Promise<Empty> {
	// Save the banner version to global state to hide it
	controller.stateManager.setGlobalState("lastDismissedCliBannerVersion", request.value ?? 1)

	// Update webview
	await controller.postStateToWebview()

	return Empty.create()
}
