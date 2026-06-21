import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import type { Controller } from ".."

export async function getLmStudioModels(_controller: Controller, _request: StringRequest): Promise<StringArray> {
	return StringArray.create({})
}
