import { Empty } from "@shared/proto/cline/common"
import { TelemetrySettingRequest } from "@shared/proto/cline/state"
import { convertProtoTelemetrySettingToDomain } from "../../../shared/proto-conversions/state/telemetry-setting-conversion"
import { Controller } from ".."

/**
 * Updates the telemetry setting
 * @param controller The controller instance
 * @param request The telemetry setting request
 * @returns Empty response
 */
export async function updateTelemetrySetting(controller: Controller, request: TelemetrySettingRequest): Promise<Empty> {
	const telemetrySetting = convertProtoTelemetrySettingToDomain(request.setting)
	await controller.updateTelemetrySetting(telemetrySetting)
	return Empty.create()
}
