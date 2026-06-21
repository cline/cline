import { StringRequest } from "@shared/proto/cline/common"
import { OpenGraphData } from "@shared/proto/cline/web"
import { Controller } from "../index"

export async function fetchOpenGraphData(_controller: Controller, _request: StringRequest): Promise<OpenGraphData> {
	return OpenGraphData.create({})
}
