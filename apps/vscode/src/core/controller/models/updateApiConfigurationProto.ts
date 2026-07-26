import { Empty } from "@shared/proto/bedrock_coder/common"
import type { UpdateApiConfigurationRequest } from "@shared/proto/bedrock_coder/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "./taskApiModel"

export async function updateApiConfigurationProto(
	controller: Controller,
	request: UpdateApiConfigurationRequest,
): Promise<Empty> {
	if (!request.apiConfiguration) throw new Error("API configuration is required")
	try {
		const previous = controller.stateManager.getApiConfiguration()
		const next = { ...previous, ...convertProtoToApiConfiguration(request.apiConfiguration) }
		const connectionChanged = [
			"awsRegion",
			"awsProfile",
			"awsBedrockEndpoint",
			"awsBedrockCaBundlePath",
			"awsBedrockControlPlaneEndpoint",
		].some(
			(field) =>
				(previous as unknown as Record<string, unknown>)[field] !== (next as unknown as Record<string, unknown>)[field],
		)
		controller.stateManager.setApiConfiguration(next)
		if (controller.task) {
			const mode = controller.stateManager.getGlobalSettingsKey("mode")
			controller.task.api = createTaskApiModelShim(resolveActiveModelIdFromApiConfiguration(next, mode))
		}
		await controller.postStateToWebview()
		if (connectionChanged) void controller.bedrockStartup.connectionChanged()
		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
