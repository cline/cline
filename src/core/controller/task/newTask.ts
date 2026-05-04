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
			...(request.taskSettings?.planModeReasoningEffort !== undefined && {
				planModeReasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.planModeReasoningEffort),
			}),
			...(request.taskSettings?.actModeReasoningEffort !== undefined && {
				actModeReasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.actModeReasoningEffort),
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
		}).filter(([_, value]) => value !== undefined),
	)

	// Remove null bytes and non-printable ASCII control characters from a string.
	// This eliminates C0 control character abuse (e.g. null-byte injection, terminal
	// escape smuggling) and logs when any mutation occurs so it is observable during
	// debugging.
	// NOTE: Real prompt-injection attacks use ordinary printable text and cannot be
	// defeated by character-level filtering alone; full mitigation requires model-level
	// and architectural safeguards (e.g. privilege separation, output monitoring).
	const sanitizeControlChars = (text: string | undefined, label: string): string | undefined => {
		if (text === undefined || text === null) {
			return text
		}
		const sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim()
		if (sanitized !== text) {
			console.warn(`[newTask] sanitizeControlChars: stripped non-printable control characters from ${label}`)
		}
		return sanitized
	}

	const sanitizedText = sanitizeControlChars(request.text, "request.text")

	// Sanitize the text content of every file entry to remove control characters.
	// Files are also listed as a vulnerable input surface in the security report.
	const sanitizedFiles = request.files?.map((file, index) => {
		const fileWithText = file as typeof file & { text?: string }
		if (typeof fileWithText.text === "string") {
			return { ...file, text: sanitizeControlChars(fileWithText.text, `request.files[${index}].text`) }
		}
		return file
	})

	const taskId = await controller.initTask(sanitizedText, request.images, sanitizedFiles ?? request.files, undefined, filteredTaskSettings)
	return String.create({ value: taskId || "" })
}
