import type { PrepareCloudHandoffRequest } from "@shared/proto/cline/cloud"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function prepareHandoff(controller: Controller, request: PrepareCloudHandoffRequest): Promise<Empty> {
	await controller.cloudHandoff.prepare(request)
	return Empty.create()
}
