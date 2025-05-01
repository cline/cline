import { UpdateBrowserSettingsRequest } from "../../../shared/proto/browser"
import { Boolean } from "../../../shared/proto/common"
import { Controller } from "../index"
import { updateGlobalState } from "../../storage/state"
import { BrowserSettings as SharedBrowserSettings } from "../../../shared/BrowserSettings"

/**
 * Update browser settings
 * @param controller The controller instance
 * @param request The browser settings request message
 * @returns Success response
 */
export async function updateBrowserSettings(controller: Controller, request: UpdateBrowserSettingsRequest): Promise<Boolean> {
	try {
		// Convert from protobuf format to shared format
		const browserSettings: SharedBrowserSettings = {
			viewport: {
				width: request.viewport?.width || 900,
				height: request.viewport?.height || 600,
			},
			remoteBrowserEnabled: request.remoteBrowserEnabled || false,
			remoteBrowserHost: request.remoteBrowserHost || undefined,
		}

		// Update global state with new settings
		await updateGlobalState(controller.context, "browserSettings", browserSettings)

		// Update task browser settings if task exists
		if (controller.task) {
			controller.task.browserSettings = browserSettings
			controller.task.browserSession.browserSettings = browserSettings
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return {
			value: true,
		}
	} catch (error) {
		console.error("Error updating browser settings:", error)
		return {
			value: false,
		}
	}
}
