import { openImage as openImageIntegration } from "@integrations/misc/open-file"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Opens an image in the system viewer
 * @param controller The controller instance
 * @param request The request message containing the image path or data URI in the 'value' field
 * @returns Empty response
 */
export async function openImage(_controller: Controller, request: StringRequest): Promise<Empty> {
	if (request.value) {
		await openImageIntegration(request.value)
	}
	return Empty.create()
}
