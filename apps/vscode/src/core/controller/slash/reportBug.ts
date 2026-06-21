import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Report bug slash command logic
 */
export async function reportBug(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create()
}
