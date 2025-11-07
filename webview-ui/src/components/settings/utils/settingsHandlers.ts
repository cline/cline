import { McpDisplayMode, OpenaiReasoningEffort, UpdateSettingsRequest } from "@shared/proto/cline/state"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * Converts values to their corresponding proto format
 * @param field - The field name
 * @param value - The value to convert
 * @returns The converted value
 * @throws Error if the value is invalid for the field
 */
const convertToProtoValue = (field: string, value: any): any => {
	if (field === "openaiReasoningEffort" && typeof value === "string") {
		switch (value) {
			case "minimal":
				return OpenaiReasoningEffort.MINIMAL
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
export const updateSetting = (field: string, value: any) => {
	const updateRequest: Partial<UpdateSettingsRequest> = {} as Partial<UpdateSettingsRequest>

	const convertedValue = convertToProtoValue(field, value)
	updateRequest[field as keyof UpdateSettingsRequest] = convertedValue

	StateServiceClient.updateSettings(UpdateSettingsRequest.create(updateRequest)).catch((error) => {
		console.error(`Failed to update setting ${field}:`, error)
	})
}

/**
 * Updates multiple fields in the settings at once.
 *
 * @param settings - An object containing the fields and values to update
 */
export const updateMultipleSettings = (settings: Record<string, any>) => {
	const updateRequest: Partial<UpdateSettingsRequest> = {} as Partial<UpdateSettingsRequest>

	for (const [field, value] of Object.entries(settings)) {
		const convertedValue = convertToProtoValue(field, value)
		updateRequest[field as keyof UpdateSettingsRequest] = convertedValue
	}

	StateServiceClient.updateSettings(UpdateSettingsRequest.create(updateRequest)).catch((error) => {
		console.error(`Failed to update multiple settings:`, error)
	})
}
