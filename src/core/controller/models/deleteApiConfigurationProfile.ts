import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function deleteApiConfigurationProfile(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (!request.value) {
			throw new Error("Profile id is required")
		}

		controller.stateManager.deleteApiConfigurationProfile(request.value)
		await controller.postStateToWebview()
		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to delete API configuration profile: ${error}`)
		throw error
	}
}
