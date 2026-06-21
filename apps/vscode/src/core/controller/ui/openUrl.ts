import type { StringRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Opens a URL in the default browser
 */
export async function openUrl(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create({})
}
