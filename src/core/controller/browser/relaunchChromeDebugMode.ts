import { BrowserRelaunchMessage } from "../../../shared/proto/browser"
import { EmptyRequest } from "../../../shared/proto/common"
import { Controller } from "../index"
import { BrowserSession } from "../../../services/browser/BrowserSession"

/**
 * Relaunch Chrome in debug mode
 * @param controller The controller instance
 * @param request The empty request message
 * @returns The browser relaunch result
 */
export async function relaunchChromeDebugMode(controller: Controller, request: EmptyRequest): Promise<BrowserRelaunchMessage> {
	try {
		const { browserSettings } = await controller.getStateToPostToWebview()
		const browserSession = new BrowserSession(controller.context, browserSettings)

		// Relaunch Chrome in debug mode
		await browserSession.relaunchChromeDebugMode(controller)

		// The actual result will be sent via postMessageToWebview in the BrowserSession.relaunchChromeDebugMode method
		// Here we just return a success message as a placeholder
		return {
			success: true,
			message: "Chrome relaunch initiated",
		}
	} catch (error) {
		return {
			success: false,
			message: `Error relaunching Chrome: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}
