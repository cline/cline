import { buildApiHandler } from "@core/api"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function loadApiConfigurationProfile(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (!request.value) {
			throw new Error("Profile id is required")
		}

		controller.stateManager.applyApiConfigurationProfile(request.value)

		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			controller.task.api = buildApiHandler(
				{
					...controller.stateManager.getApiConfiguration(),
					ulid: controller.task.ulid,
				},
				currentMode,
			)
		}

		await controller.postStateToWebview()
		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to load API configuration profile: ${error}`)
		throw error
	}
}
