import { Empty } from "@shared/proto/cline/common"
import {
	PlanActMode,
	OpenaiReasoningEffort as ProtoOpenaiReasoningEffort,
	UpdateTaskSettingsRequest,
} from "@shared/proto/cline/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Mode, OpenaiReasoningEffort } from "@/shared/storage/types"
import { Controller } from ".."

/**
 * Updates task-specific settings for the current task
 * @param controller The controller instance
 * @param request The request containing the task settings to update
 * @returns An empty response
 */
export async function updateTaskSettings(controller: Controller, request: UpdateTaskSettingsRequest): Promise<Empty> {
	const convertOpenaiReasoningEffort = (effort: ProtoOpenaiReasoningEffort): OpenaiReasoningEffort => {
		switch (effort) {
			case ProtoOpenaiReasoningEffort.LOW:
				return "low"
			case ProtoOpenaiReasoningEffort.MEDIUM:
				return "medium"
			case ProtoOpenaiReasoningEffort.HIGH:
				return "high"
			case ProtoOpenaiReasoningEffort.MINIMAL:
				return "minimal"
			default:
				return "medium"
		}
	}

	const convertPlanActMode = (mode: PlanActMode): Mode => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	try {
		// Get taskId from request first, otherwise fall back to current task
		let taskId: string
		if (request.taskId) {
			taskId = request.taskId
		} else {
			// Use current task if no taskId is provided
			if (!controller.task) {
				throw new Error("No active task to update settings for")
			}
			taskId = controller.task.taskId
		}

		if (request.settings) {
			// Extract all special case fields that need dedicated handlers
			const {
				// Fields requiring conversion
				autoApprovalSettings,
				openaiReasoningEffort,
				mode,
				customPrompt,
				planModeApiProvider,
				actModeApiProvider,
				// Fields requiring special logic
				browserSettings,
				...simpleSettings
			} = request.settings

			// Batch update for simple pass-through fields
			const filteredSettings: any = Object.fromEntries(
				Object.entries(simpleSettings).filter(([_, value]) => value !== undefined),
			)

			controller.stateManager.setTaskSettingsBatch(taskId, filteredSettings)

			// Handle fields requiring type conversion from generated protobuf types to application types
			if (autoApprovalSettings) {
				// Merge with current settings to preserve unspecified fields
				const currentAutoApprovalSettings = controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
				const mergedSettings = {
					...currentAutoApprovalSettings,
					...(autoApprovalSettings.version !== undefined && { version: autoApprovalSettings.version }),
					...(autoApprovalSettings.enableNotifications !== undefined && {
						enableNotifications: autoApprovalSettings.enableNotifications,
					}),
					actions: {
						...currentAutoApprovalSettings.actions,
						...(autoApprovalSettings.actions
							? Object.fromEntries(Object.entries(autoApprovalSettings.actions).filter(([_, v]) => v !== undefined))
							: {}),
					},
				}
				controller.stateManager.setTaskSettings(taskId, "autoApprovalSettings", mergedSettings)
			}

			if (openaiReasoningEffort !== undefined) {
				const converted = convertOpenaiReasoningEffort(openaiReasoningEffort)
				controller.stateManager.setTaskSettings(taskId, "openaiReasoningEffort", converted)
			}

			if (mode !== undefined) {
				const converted = convertPlanActMode(mode)
				controller.stateManager.setTaskSettings(taskId, "mode", converted)
			}

			if (customPrompt === "compact") {
				controller.stateManager.setTaskSettings(taskId, "customPrompt", "compact")
			}

			if (planModeApiProvider !== undefined) {
				const converted = convertProtoToApiProvider(planModeApiProvider)
				controller.stateManager.setTaskSettings(taskId, "planModeApiProvider", converted)
			}

			if (actModeApiProvider !== undefined) {
				const converted = convertProtoToApiProvider(actModeApiProvider)
				controller.stateManager.setTaskSettings(taskId, "actModeApiProvider", converted)
			}

			// Update browser settings (requires careful merging to avoid protobuf defaults)
			if (browserSettings !== undefined) {
				const currentSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

				const newBrowserSettings = {
					...currentSettings,
					viewport: {
						width: browserSettings.viewport?.width || currentSettings.viewport.width,
						height: browserSettings.viewport?.height || currentSettings.viewport.height,
					},
					...(browserSettings.remoteBrowserEnabled !== undefined && {
						remoteBrowserEnabled: browserSettings.remoteBrowserEnabled,
					}),
					...(browserSettings.remoteBrowserHost !== undefined && {
						remoteBrowserHost: browserSettings.remoteBrowserHost,
					}),
					...(browserSettings.chromeExecutablePath !== undefined && {
						chromeExecutablePath: browserSettings.chromeExecutablePath,
					}),
					...(browserSettings.disableToolUse !== undefined && {
						disableToolUse: browserSettings.disableToolUse,
					}),
					...(browserSettings.customArgs !== undefined && {
						customArgs: browserSettings.customArgs,
					}),
				}

				controller.stateManager.setTaskSettings(taskId, "browserSettings", newBrowserSettings)
			}
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error("Failed to update task settings:", error)
		throw error
	}
}
