import type { Controller } from "../index"
import type { StringRequest } from "../../../shared/proto/common"
import { Empty } from "../../../shared/proto/common"
import { openUrlInBrowser } from "../../../utils/github-url-utils"

/**
 * Opens a URL in the default browser
 * @param controller The controller instance
 * @param request The URL to open
 * @returns Empty response
 */
export async function openUrl(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await openUrlInBrowser(request.value)
		return Empty.create({})
	} catch (error) {
		console.error(`Failed to open URL: ${error}`)
		throw error
	}
}
