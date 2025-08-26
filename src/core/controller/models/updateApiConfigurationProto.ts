import { buildApiHandler } from "@core/api"
import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import type { Controller } from "../index"

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
			console.log("[APICONFIG: updateApiConfigurationProto] API configuration is required")
			throw new Error("API configuration is required")
		}

		// Convert proto ApiConfiguration to application ApiConfiguration
		const appApiConfiguration = convertProtoToApiConfiguration(request.apiConfiguration)

		// Update the API configuration in storage
		controller.stateManager.setApiConfiguration(appApiConfiguration)

		// Update the task's API handler if there's an active task
		if (controller.task) {
			const currentMode = await controller.getCurrentMode()
			controller.task.api = buildApiHandler({ ...appApiConfiguration, ulid: controller.task.ulid }, currentMode)
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
