import { EmptyRequest, String as StringMessage } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Relaunch Chrome in debug mode
 * @param controller The controller instance
 * @param request The empty request message
 * @returns The browser relaunch result as a string message
 */
export async function relaunchChromeDebugMode(_controller: Controller, _: EmptyRequest): Promise<StringMessage> {
	return StringMessage.create({})
}
