import { telemetryService } from "@/services/telemetry/TelemetryService"
import { Controller } from ".."
import { Empty, EmptyRequest } from "../../../shared/proto/common"

/**
 * Clears the current task
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function clearTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	// passing in true because this is only called when the user closes the task
	await controller.clearTask(true)
	await controller.postStateToWebview()
	return Empty.create()
}
