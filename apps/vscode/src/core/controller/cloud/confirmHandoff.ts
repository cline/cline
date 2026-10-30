import { Empty, type StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function confirmHandoff(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.cloudHandoff.confirm(request.value)
	return Empty.create()
}
