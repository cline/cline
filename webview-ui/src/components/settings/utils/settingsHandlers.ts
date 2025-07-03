import { StateServiceClient, BrowserServiceClient } from "@/services/grpc-client"
import { UpdateSettingsRequest } from "@shared/proto/state"
import { UpdateBrowserSettingsRequest } from "@shared/proto/browser"

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
