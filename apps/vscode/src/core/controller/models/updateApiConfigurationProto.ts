import { Empty } from "@shared/proto/cline/common"
import type { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
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
		controller.stateManager.setApiConfiguration(next)
		if (controller.task) {
			const mode = controller.stateManager.getGlobalSettingsKey("mode")
			controller.task.api = createTaskApiModelShim(resolveActiveModelIdFromApiConfiguration(next, mode))
		}
		await controller.postStateToWebview()
		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
