import { Controller } from ".."
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { openMention as coreOpenMention } from "../../mentions"

/**
 * Opens a mention (file path, problem, terminal, or URL)
 * @param controller The controller instance
 * @param request The string request containing the mention text
 * @returns Empty response
 */
export async function openMention(_controller: Controller, request: StringRequest): Promise<Empty> {
	coreOpenMention(request.value)
	return Empty.create()
}
