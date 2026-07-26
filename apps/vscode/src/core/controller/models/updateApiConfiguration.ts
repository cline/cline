import { Empty } from "@shared/proto/cline/common"
import type { UpdateApiConfigurationRequestNew } from "@/shared/proto/index.cline"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "./taskApiModel"

export async function updateApiConfiguration(controller: Controller, request: UpdateApiConfigurationRequestNew): Promise<Empty> {
	try {
		if (!request.updates?.options) throw new Error("API configuration options are required")
		if (!request.updateMask?.length) throw new Error("Update mask is required")
		if (request.updateMask.some((path) => path.startsWith("secrets."))) {
			throw new Error("Inference credentials cannot be stored")
		}

		const current = controller.stateManager.getApiConfiguration()
		const proto = request.updates.options
		const next = { ...current }
		const allowed = new Set([
			"awsRegion",
			"awsProfile",
			"awsBedrockEndpoint",
			"awsBedrockCaBundlePath",
			"planModeApiModelId",
			"planModeThinkingBudgetTokens",
			"planModeReasoningEffort",
			"actModeApiModelId",
			"actModeThinkingBudgetTokens",
			"actModeReasoningEffort",
		])
		for (const path of request.updateMask) {
			const [prefix, field] = path.split(".", 2)
			if (prefix !== "options" || !field || !allowed.has(field)) {
				throw new Error(`Unsupported API configuration field: ${path}`)
			}
			;(next as Record<string, unknown>)[field] = (proto as unknown as Record<string, unknown>)[field]
		}
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
