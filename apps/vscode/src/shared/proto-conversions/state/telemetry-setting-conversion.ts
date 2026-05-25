import { TelemetrySettingEnum } from "@shared/proto/cline/state"
import { TelemetrySetting } from "../../TelemetrySetting"

/**
 * Converts a domain TelemetrySetting string to a proto TelemetrySettingEnum
 */
export function convertDomainTelemetrySettingToProto(setting: TelemetrySetting): TelemetrySettingEnum {
	switch (setting) {
		case "unset":
			return TelemetrySettingEnum.UNSET
		case "enabled":
			return TelemetrySettingEnum.ENABLED
		case "disabled":
			return TelemetrySettingEnum.DISABLED
		default:
			return TelemetrySettingEnum.UNSET
	}
}

/**
 * Converts a proto TelemetrySettingEnum to a domain TelemetrySetting string
 */
export function convertProtoTelemetrySettingToDomain(setting: TelemetrySettingEnum): TelemetrySetting {
	switch (setting) {
		case TelemetrySettingEnum.UNSET:
			return "unset"
		case TelemetrySettingEnum.ENABLED:
			return "enabled"
		case TelemetrySettingEnum.DISABLED:
			return "disabled"
		default:
			return "unset"
	}
}
