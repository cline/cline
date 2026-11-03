import { Empty, type StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function retryHandoffMessage(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.cloudHandoff.retryMessage(request.value)
	return Empty.create()
}
