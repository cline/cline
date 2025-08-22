import { UpdateBrowserSettingsRequest } from "@shared/proto/cline/browser"
import { McpDisplayMode, OpenaiReasoningEffort, UpdateSettingsRequest } from "@shared/proto/cline/state"
import { BrowserServiceClient, StateServiceClient } from "@/services/grpc-client"

/**
 * Converts values to their corresponding proto format
 * @param field - The field name
 * @param value - The value to convert
 * @returns The converted value
 * @throws Error if the value is invalid for the field
 */
const convertToProtoValue = (field: keyof UpdateSettingsRequest, value: any): any => {
	if (field === "openaiReasoningEffort" && typeof value === "string") {
		switch (value) {
			case "low":
				return OpenaiReasoningEffort.LOW
			case "medium":
				return OpenaiReasoningEffort.MEDIUM
			case "high":
				return OpenaiReasoningEffort.HIGH
			default:
				throw new Error(`Invalid OpenAI reasoning effort value: ${value}`)
		}
	} else if (field === "mcpDisplayMode" && typeof value === "string") {
		switch (value) {
			case "rich":
				return McpDisplayMode.RICH
			case "plain":
				return McpDisplayMode.PLAIN
			case "markdown":
				return McpDisplayMode.MARKDOWN
			default:
				throw new Error(`Invalid MCP display mode value: ${value}`)
		}
	}
	return value
}

/**
 * Updates a single field in the settings.
 *
 * @param field - The field key to update
 * @param value - The new value for the field
 */
export const updateSetting = (field: keyof UpdateSettingsRequest, value: any) => {
	const updateRequest: Partial<UpdateSettingsRequest> = {}

	const convertedValue = convertToProtoValue(field, value)
	updateRequest[field] = convertedValue

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
