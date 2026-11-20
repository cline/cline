import { Empty, type StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function discardHandoff(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.cloudHandoff.discard(request.value)
	return Empty.create()
}
