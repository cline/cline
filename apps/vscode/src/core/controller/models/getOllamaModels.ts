import { StringArray, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function getOllamaModels(_controller: Controller, _request: StringRequest): Promise<StringArray> {
	return StringArray.create({})
}
