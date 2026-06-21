import { StringRequest } from "@shared/proto/cline/common"
import { OcaCompatibleModelInfo } from "@shared/proto/cline/models"
import { Controller } from ".."

export async function refreshOcaModels(_controller: Controller, _request: StringRequest): Promise<OcaCompatibleModelInfo> {
	return OcaCompatibleModelInfo.create({})
}
