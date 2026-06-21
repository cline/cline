import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function hicapAuthClicked(_: Controller, __: EmptyRequest): Promise<Empty> {
	return Empty.create({})
}
