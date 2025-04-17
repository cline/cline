import { BrowserConnectionInfo } from "../../../shared/proto/browser"
import { EmptyRequest } from "../../../shared/proto/common"
import { Controller } from "../index"
import { getAllExtensionState } from "../../storage/state"

/**
 * Get information about the current browser connection
 * @param controller The controller instance
 * @param request The request message
 * @returns The browser connection info
 */
export async function getBrowserConnectionInfo(controller: Controller, request: EmptyRequest): Promise<BrowserConnectionInfo> {
	try {
		// Get browser settings from extension state
		const { browserSettings } = await getAllExtensionState(controller.context)

		// Check if there's an active browser session by using the controller's handleWebviewMessage approach
		// This is similar to what's done in controller/index.ts for the "getBrowserConnectionInfo" message
		if (controller.task?.browserSession) {
			// Access the browser session through the controller's task property
			// Using indexer notation to access private property
			const browserSession = controller.task.browserSession
			const connectionInfo = browserSession.getConnectionInfo()

			// Convert from BrowserSession.BrowserConnectionInfo to proto.BrowserConnectionInfo
			return {
				isConnected: connectionInfo.isConnected,
				isRemote: connectionInfo.isRemote,
				host: connectionInfo.host || "", // Ensure host is never undefined
			}
		}

		// Fallback to browser settings if no active browser session
		return {
			isConnected: false,
			isRemote: !!browserSettings.remoteBrowserEnabled,
			host: browserSettings.remoteBrowserHost || "",
		}
	} catch (error: unknown) {
		console.error("Error getting browser connection info:", error)
		return {
			isConnected: false,
			isRemote: false,
			host: "",
		}
	}
}
