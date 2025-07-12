import { StateServiceClient, BrowserServiceClient } from "@/services/grpc-client"
import { TelemetrySettingEnum, TelemetrySettingRequest, UpdateSettingsRequest } from "@shared/proto/state"
import { UpdateBrowserSettingsRequest } from "@shared/proto/browser"
import { TelemetrySetting } from "@shared/TelemetrySetting"

/**
 * Updates a single field in the settings.
 *
 * @param field - The field key to update
 * @param value - The new value for the field
 */
export const updateSetting = (field: keyof UpdateSettingsRequest, value: any) => {
	const updateRequest: Partial<UpdateSettingsRequest> = {}
	updateRequest[field] = value

	StateServiceClient.updateSettings(UpdateSettingsRequest.create(updateRequest)).catch((error) => {
		console.error(`Failed to update setting ${field}:`, error)
	})
}

/**
 * Updates the telemetry setting.
 *
 * @param setting - The new telemetry setting
 */
export const updateTelemetrySetting = (setting: TelemetrySetting) => {
	const settingEnum =
		setting === "enabled"
			? TelemetrySettingEnum.ENABLED
			: setting === "disabled"
				? TelemetrySettingEnum.DISABLED
				: TelemetrySettingEnum.UNSET

	const request = TelemetrySettingRequest.create({
		setting: settingEnum,
	})

	StateServiceClient.updateTelemetrySetting(request).catch((error) => {
		console.error("Failed to update telemetry setting:", error)
	})
}

/**
 * Updates a single browser setting field.
 *
 * @param field - The field key to update
 * @param value - The new value for the field
 */
export const updateBrowserSetting = (field: keyof UpdateBrowserSettingsRequest, value: any) => {
	const updateRequest: Partial<UpdateBrowserSettingsRequest> = {
		metadata: {},
		[field]: value,
	}

	BrowserServiceClient.updateBrowserSettings(UpdateBrowserSettingsRequest.create(updateRequest)).catch((error) => {
		console.error(`Failed to update browser setting ${field}:`, error)
	})
}
