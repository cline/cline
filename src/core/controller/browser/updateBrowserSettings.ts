import { UpdateBrowserSettingsRequest } from "@shared/proto/cline/browser"
import { Boolean } from "@shared/proto/cline/common"
import { Controller } from "../index"
import { updateGlobalState, getGlobalState } from "../../storage/state"
import { BrowserSettings as SharedBrowserSettings, DEFAULT_BROWSER_SETTINGS } from "../../../shared/BrowserSettings"

/**
 * Update browser settings
 * @param controller The controller instance
 * @param request The browser settings request message
 * @returns Success response
 */
export async function updateBrowserSettings(controller: Controller, request: UpdateBrowserSettingsRequest): Promise<Boolean> {
	try {
		// Get current browser settings to preserve fields not in the request
		const currentSettings = (await getGlobalState(controller.context, "browserSettings")) as SharedBrowserSettings | undefined
		const mergedWithDefaults = { ...DEFAULT_BROWSER_SETTINGS, ...currentSettings }

		// Convert from protobuf format to shared format, merging with existing settings
		const newBrowserSettings: SharedBrowserSettings = {
			...mergedWithDefaults, // Start with existing settings (and defaults)
			viewport: {
				// Apply updates from request
				width: request.viewport?.width || mergedWithDefaults.viewport.width,
				height: request.viewport?.height || mergedWithDefaults.viewport.height,
			},
			// Explicitly handle optional boolean and string fields from the request
			remoteBrowserEnabled:
				request.remoteBrowserEnabled === undefined
					? mergedWithDefaults.remoteBrowserEnabled
					: request.remoteBrowserEnabled,
			remoteBrowserHost:
				request.remoteBrowserHost === undefined ? mergedWithDefaults.remoteBrowserHost : request.remoteBrowserHost,
			chromeExecutablePath:
				// If chromeExecutablePath is explicitly in the request (even as ""), use it.
				// Otherwise, fall back to mergedWithDefaults.
				"chromeExecutablePath" in request ? request.chromeExecutablePath : mergedWithDefaults.chromeExecutablePath,
			disableToolUse: request.disableToolUse === undefined ? mergedWithDefaults.disableToolUse : request.disableToolUse,
		}

		// Update global state with new settings
		await updateGlobalState(controller.context, "browserSettings", newBrowserSettings)

		// Update task browser settings if task exists
		if (controller.task) {
			controller.task.browserSettings = newBrowserSettings
			controller.task.browserSession.browserSettings = newBrowserSettings
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Boolean.create({
			value: true,
		})
	} catch (error) {
		console.error("Error updating browser settings:", error)
		return Boolean.create({
			value: false,
		})
	}
}
