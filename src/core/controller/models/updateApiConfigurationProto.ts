import type { Controller } from "../index"
import { Empty } from "@shared/proto/common"
import { UpdateApiConfigurationRequest } from "@shared/proto/models"
import { updateApiConfiguration } from "../../storage/state"
import { buildApiHandler } from "@api/index"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"

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
		await updateApiConfiguration(controller.context, appApiConfiguration)

		// Update the task's API handler if there's an active task
		if (controller.task) {
			const currentMode = await controller.getCurrentMode()
			controller.task.api = buildApiHandler(appApiConfiguration, currentMode)
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
