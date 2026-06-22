import { Empty } from "@shared/proto/cline/common"
import type { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import type { Controller } from "../index"

export async function updateApiConfigurationProto(
	_controller: Controller,
	_request: UpdateApiConfigurationRequest,
): Promise<Empty> {
	return Empty.create()
}
