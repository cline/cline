import { StringArray } from "@shared/proto/cline/common"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { Controller } from ".."

export async function refreshOpenAiModels(_controller: Controller, _request: OpenAiModelsRequest): Promise<StringArray> {
	return StringArray.create({})
}
