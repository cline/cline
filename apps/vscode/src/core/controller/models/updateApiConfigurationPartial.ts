import type { ApiConfiguration } from "@shared/api"
import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationPartialRequest } from "@shared/proto/cline/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearOrganizationForClinePassProviderSelection } from "./handleClinePassProviderSelection"
import { normalizeProviderSwitchModel } from "./providerSwitchNormalization"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "./taskApiModel"

export function pickMaskedApiConfigurationUpdates(
	configuration: ApiConfiguration,
	updateMask: string[],
): Partial<ApiConfiguration> {
	const updates: Partial<ApiConfiguration> = {}
	for (const field of updateMask) {
		;(updates as Record<string, unknown>)[field] = (configuration as Record<string, unknown>)[field]
	}
	return updates
}

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

		// Persist only fields explicitly named by the mask. Re-saving a reconstructed
		// full configuration can copy stale Plan/Act values over independent settings.
		const currentConfig = controller.stateManager.getApiConfiguration()
		const newConfigValues = convertProtoToApiConfiguration(request.apiConfiguration)
		const partialUpdates = pickMaskedApiConfigurationUpdates(newConfigValues, request.updateMask)
		const normalizedUpdates = normalizeProviderSwitchModel(controller.getProviderConfigStore(), currentConfig, partialUpdates)

		// Update storage and task API model shim
		controller.stateManager.setApiConfiguration(normalizedUpdates)
		const updatedConfig = controller.stateManager.getApiConfiguration()
		clearOrganizationForClinePassProviderSelection(controller, updatedConfig)
		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			const modelId = resolveActiveModelIdFromApiConfiguration(updatedConfig, currentMode)
			controller.task.api = createTaskApiModelShim(modelId)
		}
		controller.handleApiConfigurationChanged(currentConfig, updatedConfig)

		// Notify webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration (partial): ${error}`)
		throw error
	}
}
