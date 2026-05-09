import { Empty } from "@shared/proto/cline/common"
import { PlanActMode, UpdateTaskSettingsRequest } from "@shared/proto/cline/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Mode } from "@/shared/storage/types"
import { Controller } from ".."
import { normalizeOpenaiReasoningEffort } from "./reasoningEffort"

/**
 * Updates task-specific settings for the current task
 * @param controller The controller instance
 * @param request The request containing the task settings to update
 * @returns An empty response
 */
export async function updateTaskSettings(controller: Controller, request: UpdateTaskSettingsRequest): Promise<Empty> {
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
				planConfig,
				actConfig,
				mode,
				customPrompt,
				// Fields requiring special logic
				browserSettings,
				...simpleSettings
			} = request.settings

			// Batch update for simple pass-through fields
			const filteredSettings: any = Object.fromEntries(
				Object.entries(simpleSettings).filter(([key, value]) => key !== "openaiReasoningEffort" && value !== undefined),
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

			if (planConfig?.reasoningEffort !== undefined) {
				const converted = normalizeOpenaiReasoningEffort(planConfig.reasoningEffort)
				const currentPlanConfig = controller.stateManager.getApiConfiguration().planConfig ?? {}
				controller.stateManager.setTaskSettings(taskId, "planConfig", {
					apiProvider: "openrouter" as const,
					...currentPlanConfig,
					reasoningEffort: converted,
				})
			}

			if (actConfig?.reasoningEffort !== undefined) {
				const converted = normalizeOpenaiReasoningEffort(actConfig.reasoningEffort)
				const currentActConfig = controller.stateManager.getApiConfiguration().actConfig ?? {}
				controller.stateManager.setTaskSettings(taskId, "actConfig", {
					apiProvider: "openrouter" as const,
					...currentActConfig,
					reasoningEffort: converted,
				})
			}

			if (mode !== undefined) {
				const converted = convertPlanActMode(mode)
				controller.stateManager.setTaskSettings(taskId, "mode", converted)
			}

			if (customPrompt === "compact") {
				controller.stateManager.setTaskSettings(taskId, "customPrompt", "compact")
			}

			if (planConfig?.apiProvider !== undefined) {
				const converted = convertProtoToApiProvider(planConfig.apiProvider) as import("@shared/api").ApiProvider
				const currentPlanConfig = controller.stateManager.getApiConfiguration().planConfig ?? {}
				controller.stateManager.setTaskSettings(taskId, "planConfig", { ...currentPlanConfig, apiProvider: converted })
			}

			if (actConfig?.apiProvider !== undefined) {
				const converted = convertProtoToApiProvider(actConfig.apiProvider) as import("@shared/api").ApiProvider
				const currentActConfig = controller.stateManager.getApiConfiguration().actConfig ?? {}
				controller.stateManager.setTaskSettings(taskId, "actConfig", { ...currentActConfig, apiProvider: converted })
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
		throw error
	}
}
