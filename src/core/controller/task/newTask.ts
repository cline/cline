import { String } from "@shared/proto/cline/common"
import { PlanActMode, OpenaiReasoningEffort as ProtoOpenaiReasoningEffort } from "@shared/proto/cline/state"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Settings } from "@shared/storage/state-keys"
import { convertProtoToApiProvider } from "@/shared/proto-conversions/models/api-configuration-conversion"
import { DEFAULT_BROWSER_SETTINGS } from "../../../shared/BrowserSettings"
import { Controller } from ".."

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images, and optional task settings
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<String> {
	const convertOpenaiReasoningEffort = (effort: ProtoOpenaiReasoningEffort): string => {
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

	const convertPlanActMode = (mode: PlanActMode): string => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	const filteredTaskSettings: Partial<Settings> = Object.fromEntries(
		Object.entries({
			...request.taskSettings,
			...(request.taskSettings?.autoApprovalSettings && {
				autoApprovalSettings: (() => {
					// Merge with global settings to ensure complete settings for new task
					const globalSettings = controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
					const incomingSettings = request.taskSettings.autoApprovalSettings
					return {
						...globalSettings,
						...(incomingSettings.version !== undefined && { version: incomingSettings.version }),
						...(incomingSettings.enableNotifications !== undefined && {
							enableNotifications: incomingSettings.enableNotifications,
						}),
						actions: {
							...globalSettings.actions,
							...(incomingSettings.actions
								? Object.fromEntries(Object.entries(incomingSettings.actions).filter(([_, v]) => v !== undefined))
								: {}),
						},
					}
				})(),
			}),
			...(request.taskSettings?.browserSettings && {
				browserSettings: {
					viewport: request.taskSettings.browserSettings.viewport || DEFAULT_BROWSER_SETTINGS.viewport,
					remoteBrowserHost: request.taskSettings.browserSettings.remoteBrowserHost,
					remoteBrowserEnabled: request.taskSettings.browserSettings.remoteBrowserEnabled,
					chromeExecutablePath: request.taskSettings.browserSettings.chromeExecutablePath,
					disableToolUse: request.taskSettings.browserSettings.disableToolUse,
					customArgs: request.taskSettings.browserSettings.customArgs,
				},
			}),
			...(request.taskSettings?.openaiReasoningEffort !== undefined && {
				openaiReasoningEffort: convertOpenaiReasoningEffort(request.taskSettings.openaiReasoningEffort),
			}),
			...(request.taskSettings?.mode !== undefined && {
				mode: convertPlanActMode(request.taskSettings.mode),
			}),
			...(request.taskSettings?.customPrompt === "compact" && {
				customPrompt: "compact",
			}),
			...(request.taskSettings?.planModeApiProvider !== undefined && {
				planModeApiProvider: convertProtoToApiProvider(request.taskSettings.planModeApiProvider),
			}),
			...(request.taskSettings?.actModeApiProvider !== undefined && {
				actModeApiProvider: convertProtoToApiProvider(request.taskSettings.actModeApiProvider),
			}),
			...(request.taskSettings?.hooksEnabled !== undefined && {
				hooksEnabled: (() => {
					const isEnabled = !!request.taskSettings.hooksEnabled

					// Platform validation: Only allow enabling hooks on macOS and Linux
					if (isEnabled && process.platform === "win32") {
						throw new Error("Hooks are not yet supported on Windows")
					}

					return isEnabled
				})(),
			}),
		}).filter(([_, value]) => value !== undefined),
	)

	const taskId = await controller.initTask(request.text, request.images, request.files, undefined, filteredTaskSettings)
	return String.create({ value: taskId || "" })
}
