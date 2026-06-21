import { ChromePath } from "@shared/proto/cline/browser"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Get the detected Chrome executable path
 * @param controller The controller instance
 * @param request The empty request message
 * @returns The detected Chrome path and whether it's bundled
 */
export async function getDetectedChromePath(_controller: Controller, _: EmptyRequest): Promise<ChromePath> {
	return ChromePath.create({})
}
