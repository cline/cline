import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationRequestNew } from "@/shared/proto/index.cline"
import type { Controller } from "../index"

export async function updateApiConfiguration(
	_controller: Controller,
	_request: UpdateApiConfigurationRequestNew,
): Promise<Empty> {
	return Empty.create()
}
