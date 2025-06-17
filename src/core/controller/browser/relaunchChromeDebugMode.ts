import { EmptyRequest, String as StringMessage } from "../../../shared/proto/common"
import { Controller } from "../index"
import { BrowserSession } from "../../../services/browser/BrowserSession"

/**
 * Relaunch Chrome in debug mode
 * @param controller The controller instance
 * @param request The empty request message
 * @returns The browser relaunch result as a string message
 */
export async function relaunchChromeDebugMode(controller: Controller, _: EmptyRequest): Promise<StringMessage> {
	try {
		const { browserSettings } = await controller.getStateToPostToWebview()
		const browserSession = new BrowserSession(controller.context, browserSettings)

		// Relaunch Chrome in debug mode
		await browserSession.relaunchChromeDebugMode(controller)

		// The actual result will be sent via postMessageToWebview in the BrowserSession.relaunchChromeDebugMode method
		// Here we just return a message as a placeholder
		return StringMessage.create({
			value: "Chrome relaunch initiated",
		})
	} catch (error) {
		throw new Error(`Error relaunching Chrome: ${error instanceof Error ? error.message : globalThis.String(error)}`)
	}
}
