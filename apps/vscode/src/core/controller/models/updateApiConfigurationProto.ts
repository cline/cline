import { Empty } from "@shared/proto/cline/common"
import type { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearOrganizationForClinePassProviderSelection } from "./handleClinePassProviderSelection"
import { normalizeProviderSwitchModel } from "./providerSwitchNormalization"
import { mirrorPlanActApiConfiguration } from "./sharedModeConfiguration"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "./taskApiModel"

/**
 * Updates API configuration
 * @param controller The controller instance
 * @param request The update API configuration request
 * @returns Empty response
 */
export async function updateApiConfigurationProto(
	controller: Controller,
	request: UpdateApiConfigurationRequest,
): Promise<Empty> {
	try {
		if (!request.apiConfiguration) {
			Logger.log("[APICONFIG: updateApiConfigurationProto] API configuration is required")
			throw new Error("API configuration is required")
		}

		const convertedApiConfigurationFromProto = mirrorPlanActApiConfiguration(
			convertProtoToApiConfiguration(request.apiConfiguration),
		)

		const previousApiConfiguration = controller.stateManager.getApiConfiguration()
		const normalizedApiConfiguration = normalizeProviderSwitchModel(
			controller.getProviderConfigStore(),
			previousApiConfiguration,
			convertedApiConfigurationFromProto,
		)

		// Update the API configuration in storage
		controller.stateManager.setApiConfiguration(normalizedApiConfiguration)
		await clearOrganizationForClinePassProviderSelection(controller, normalizedApiConfiguration)

		// Update the task's API handler if there's an active task
		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			const modelId = resolveActiveModelIdFromApiConfiguration(normalizedApiConfiguration, currentMode)
			controller.task.api = createTaskApiModelShim(modelId)
		}
		controller.handleApiConfigurationChanged(previousApiConfiguration, normalizedApiConfiguration)

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
