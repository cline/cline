import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function openFile(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create({})
}
