import { EmptyRequest } from "@shared/proto/cline/common"
import { VsCodeLmModelsArray } from "@shared/proto/cline/models"
import { Controller } from ".."

export async function getVsCodeLmModels(_controller: Controller, _request: EmptyRequest): Promise<VsCodeLmModelsArray> {
	return VsCodeLmModelsArray.create({})
}
