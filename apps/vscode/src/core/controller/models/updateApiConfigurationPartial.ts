import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationPartialRequest } from "@shared/proto/cline/models"
import type { Controller } from "../index"

export async function updateApiConfigurationPartial(
	_controller: Controller,
	_request: UpdateApiConfigurationPartialRequest,
): Promise<Empty> {
	return Empty.create()
}
