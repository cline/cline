import { Empty, type StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/** Saves the Cline model new cloud tasks run on; a running cloud task keeps its own. */
export async function setCloudModel(controller: Controller, request: StringRequest): Promise<Empty> {
	controller.stateManager.setGlobalState("cloudModelId", request.value.trim() || undefined)
	await controller.postStateToWebview()
	return Empty.create()
}
