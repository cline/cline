import { Empty } from "@shared/proto/cline/common"
import { PlanActMode, OpenaiReasoningEffort as ProtoOpenaiReasoningEffort } from "@shared/proto/cline/state"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Settings } from "@/core/storage/state-keys"
import { DEFAULT_BROWSER_SETTINGS } from "../../../shared/BrowserSettings"
import { convertProtoToAutoApprovalSettings } from "../../../shared/proto-conversions/models/auto-approval-settings-conversion"
import { Controller } from ".."

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images, and optional task settings
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<Empty> {
	const taskSettingsConverted: any = {
		...request.taskSettings,
	}

	if (request.taskSettings) {
		// Convert complex nested objects
		if (request.taskSettings.autoApprovalSettings) {
			taskSettingsConverted.autoApprovalSettings = convertProtoToAutoApprovalSettings({
				...request.taskSettings.autoApprovalSettings,
				metadata: {},
			})
		}

		if (request.taskSettings.browserSettings) {
			taskSettingsConverted.browserSettings = {
				viewport: request.taskSettings.browserSettings.viewport || DEFAULT_BROWSER_SETTINGS.viewport,
				remoteBrowserHost: request.taskSettings.browserSettings.remoteBrowserHost,
				remoteBrowserEnabled: request.taskSettings.browserSettings.remoteBrowserEnabled,
				chromeExecutablePath: request.taskSettings.browserSettings.chromeExecutablePath,
				disableToolUse: request.taskSettings.browserSettings.disableToolUse,
				customArgs: request.taskSettings.browserSettings.customArgs,
			}
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

	const filteredTaskSettings: Partial<Settings> = Object.fromEntries(
		Object.entries(taskSettingsConverted).filter(([_, value]) => value !== undefined),
	)

	await controller.initTask(request.text, request.images, request.files, undefined, filteredTaskSettings)
	return Empty.create()
}
