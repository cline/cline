import { buildApiHandler } from "@core/api"
import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationPartialRequest } from "@shared/proto/cline/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import type { Controller } from "../index"

/**
 * Updates API configuration with partial values using FieldMask
 *
 * Allows clients to update individual API configuration fields without
 * overwriting the entire configuration. Only fields specified in the update_mask
 * are updated from api_configuration.
 *
 * @param controller The controller instance
 * @param request The partial update API configuration request with FieldMask
 * @returns Empty response
 */
export async function updateApiConfigurationPartial(
	controller: Controller,
	request: UpdateApiConfigurationPartialRequest,
): Promise<Empty> {
	try {
		// Validate request
		if (!request.updateMask || request.updateMask.length === 0) {
			throw new Error("update_mask is required and must contain at least one field")
		}

		if (!request.apiConfiguration) {
			throw new Error("api_configuration is required")
		}

		// Get current config and convert new values from proto format
		const currentConfig = controller.stateManager.getApiConfiguration()
		const newConfigValues = convertProtoToApiConfiguration(request.apiConfiguration)

		// Apply only the fields specified in the mask
		const updatedConfig = { ...currentConfig }
		for (const field of request.updateMask) {
			;(updatedConfig as Record<string, any>)[field] = (newConfigValues as Record<string, any>)[field]
		}

		// Update storage and task API handler
		controller.stateManager.setApiConfiguration(updatedConfig)
		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			controller.task.api = buildApiHandler({ ...updatedConfig, ulid: controller.task.ulid }, currentMode)
		}

		// Notify webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error(`Failed to update API configuration (partial): ${error}`)
		throw error
	}
}
