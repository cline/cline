import { Empty } from "@shared/proto/cline/common"
import { TelemetrySettingRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function updateTelemetrySetting(_controller: Controller, _request: TelemetrySettingRequest): Promise<Empty> {
	return Empty.create({})
}
