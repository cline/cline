import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function requestyAuthClicked(_: Controller, _req: StringRequest): Promise<Empty> {
	return Empty.create({})
}
