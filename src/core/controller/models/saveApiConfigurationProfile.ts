import { Empty } from "@shared/proto/cline/common"
import { SaveApiConfigurationProfileRequest } from "@shared/proto/cline/models"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function saveApiConfigurationProfile(
	controller: Controller,
	request: SaveApiConfigurationProfileRequest,
): Promise<Empty> {
	try {
		controller.stateManager.saveApiConfigurationProfile(request.name, request.id)
		await controller.postStateToWebview()
		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to save API configuration profile: ${error}`)
		throw error
	}
}
