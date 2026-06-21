import { BooleanRequest, StringArrays } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function selectFiles(_controller: Controller, _request: BooleanRequest): Promise<StringArrays> {
	return StringArrays.create({})
}
