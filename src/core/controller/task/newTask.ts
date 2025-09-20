import { Empty } from "@shared/proto/cline/common"
import { PlanActMode, OpenaiReasoningEffort as ProtoOpenaiReasoningEffort } from "@shared/proto/cline/state"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Controller } from ".."

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images, and optional task settings
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<Empty> {
	let taskSettingsConverted: any

	if (request.taskSettings) {
		taskSettingsConverted = {}

		// Copy over all non-enum properties that don't need conversion
		if (request.taskSettings.planActSeparateModelsSetting !== undefined) {
			taskSettingsConverted.planActSeparateModelsSetting = request.taskSettings.planActSeparateModelsSetting
		}
		if (request.taskSettings.preferredLanguage !== undefined) {
			taskSettingsConverted.preferredLanguage = request.taskSettings.preferredLanguage
		}
		if (request.taskSettings.strictPlanModeEnabled !== undefined) {
			taskSettingsConverted.strictPlanModeEnabled = request.taskSettings.strictPlanModeEnabled
		}
		if (request.taskSettings.useAutoCondense !== undefined) {
			taskSettingsConverted.useAutoCondense = request.taskSettings.useAutoCondense
		}
		if (request.taskSettings.focusChainSettings !== undefined) {
			taskSettingsConverted.focusChainSettings = request.taskSettings.focusChainSettings
		}
		if (request.taskSettings.yoloModeToggled !== undefined) {
			taskSettingsConverted.yoloModeToggled = request.taskSettings.yoloModeToggled
		}
		if (request.taskSettings.enableCheckpointsSetting !== undefined) {
			taskSettingsConverted.enableCheckpointsSetting = request.taskSettings.enableCheckpointsSetting
		}

		// Convert enum fields
		if (request.taskSettings.openaiReasoningEffort !== undefined) {
			switch (request.taskSettings.openaiReasoningEffort) {
				case ProtoOpenaiReasoningEffort.LOW:
					taskSettingsConverted.openaiReasoningEffort = "low"
					break
				case ProtoOpenaiReasoningEffort.MEDIUM:
					taskSettingsConverted.openaiReasoningEffort = "medium"
					break
				case ProtoOpenaiReasoningEffort.HIGH:
					taskSettingsConverted.openaiReasoningEffort = "high"
					break
				case ProtoOpenaiReasoningEffort.MINIMAL:
					taskSettingsConverted.openaiReasoningEffort = "minimal"
					break
			}
		}

		if (request.taskSettings.mode !== undefined) {
			if (request.taskSettings.mode === PlanActMode.PLAN) {
				taskSettingsConverted.mode = "plan"
			} else if (request.taskSettings.mode === PlanActMode.ACT) {
				taskSettingsConverted.mode = "act"
			}
		}

		if (request.taskSettings.customPrompt === "compact") {
			taskSettingsConverted.customPrompt = "compact"
		}
	}

	await controller.initTask(request.text, request.images, request.files, undefined, taskSettingsConverted)
	return Empty.create()
}
