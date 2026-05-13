import { String } from "@shared/proto/cline/common"
import { PlanActMode } from "@shared/proto/cline/state"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Settings } from "@shared/storage/state-keys"
import { convertProtoToApiProvider } from "@/shared/proto-conversions/models/api-configuration-conversion"
import { DEFAULT_BROWSER_SETTINGS } from "../../../shared/BrowserSettings"
import { Controller } from ".."
import { normalizeOpenaiReasoningEffort } from "../state/reasoningEffort"

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images, and optional task settings
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<String> {
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
			...(request.taskSettings?.planConfig?.reasoningEffort !== undefined && {
				planConfig: {
					reasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.planConfig.reasoningEffort),
				},
			}),
			...(request.taskSettings?.actConfig?.reasoningEffort !== undefined && {
				actConfig: {
					reasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.actConfig.reasoningEffort),
				},
			}),
			...(request.taskSettings?.mode !== undefined && {
				mode: convertPlanActMode(request.taskSettings.mode),
			}),
			...(request.taskSettings?.customPrompt === "compact" && {
				customPrompt: "compact",
			}),
			...(request.taskSettings?.planConfig?.apiProvider !== undefined && {
				planConfig: {
					apiProvider: convertProtoToApiProvider(request.taskSettings.planConfig.apiProvider),
				},
			}),
			...(request.taskSettings?.actConfig?.apiProvider !== undefined && {
				actConfig: {
					apiProvider: convertProtoToApiProvider(request.taskSettings.actConfig.apiProvider),
				},
			}),
		}).filter(([_, value]) => value !== undefined),
	)

	const taskId = await controller.initTask(request.text, request.images, request.files, undefined, filteredTaskSettings)
	return String.create({ value: taskId || "" })
}
