import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Command slash command logic
 */
export async function condense(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create()
}
