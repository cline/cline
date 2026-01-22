import type { StringRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { openUrlInBrowser } from "../../../utils/github-url-utils"
import type { Controller } from "../index"

/**
 * Opens a URL in the default browser
 * @param controller The controller instance
 * @param request The URL to open
 * @returns Empty response
 */
export async function openUrl(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await openUrlInBrowser(request.value)
		return Empty.create({})
	} catch (error) {
		Logger.error(`Failed to open URL: ${error}`)
		throw error
	}
}
