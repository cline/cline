import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { writeTextToClipboard } from "@/utils/env"
import { Controller } from ".."

/**
 * Copies text to the system clipboard
 * @param controller The controller instance
 * @param request The request containing the text to copy
 * @returns Empty response
 */
export async function copyToClipboard(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (request.value) {
			await writeTextToClipboard(request.value)
		}
	} catch (error) {
		Logger.error("Error copying to clipboard:", error)
	}
	return Empty.create()
}
