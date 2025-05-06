import { ChromePath } from "../../../shared/proto/browser"
import { EmptyRequest } from "../../../shared/proto/common"
import { Controller } from "../index"
import { getAllExtensionState } from "../../storage/state"
import { BrowserSession } from "../../../services/browser/BrowserSession"

/**
 * Get the detected Chrome executable path
 * @param controller The controller instance
 * @param request The empty request message
 * @returns The detected Chrome path and whether it's bundled
 */
export async function getDetectedChromePath(controller: Controller, request: EmptyRequest): Promise<ChromePath> {
	try {
		const { browserSettings } = await getAllExtensionState(controller.context)
		const browserSession = new BrowserSession(controller.context, browserSettings)
		const result = await browserSession.getDetectedChromePath()

		return {
			path: result.path,
			isBundled: result.isBundled,
		}
	} catch (error) {
		console.error("Error getting detected Chrome path:", error)
		return {
			path: "",
			isBundled: false,
		}
	}
}
