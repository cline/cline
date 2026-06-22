import { BooleanResponse, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function ifFileExistsRelativePath(_controller: Controller, _request: StringRequest): Promise<BooleanResponse> {
	return BooleanResponse.create({})
}
