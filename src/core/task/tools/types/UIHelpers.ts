import type { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import type { ClineDefaultTool } from "@shared/tools"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { telemetryService } from "@/services/telemetry"
import type { ToolParamName, ToolUse } from "../../../assistant-message"
import { showNotificationForApproval } from "../../utils"
import { removeClosingTag } from "../utils/ToolConstants"
import type { TaskConfig } from "./TaskConfig"

/**
 * Strongly-typed UI helper functions for tool handlers
 */
export interface StronglyTypedUIHelpers {
	// Core UI methods
	say: (
		type: ClineSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
		call_id?: string,
	) => Promise<number | undefined>

	ask: (
		type: ClineAsk,
		text?: string,
		partial?: boolean,
	) => Promise<{
		response: ClineAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}>

	// Utility methods
	removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => string
	removeLastPartialMessageIfExistsWithType: (
		type: "ask" | "say",
		askOrSay: ClineAsk | ClineSay,
		call_id?: string,
	) => Promise<void>

	// Approval methods
	shouldAutoApproveTool: (toolName: ClineDefaultTool) => boolean | [boolean, boolean]
	shouldAutoApproveToolWithPath: (toolName: ClineDefaultTool, path?: string) => Promise<boolean>
	askApproval: (messageType: ClineAsk, message: string) => Promise<boolean>

	// Telemetry and notifications
	captureTelemetry: (toolName: ClineDefaultTool, autoApproved: boolean, approved: boolean, isNativeToolCall?: boolean) => void
	showNotificationIfEnabled: (message: string) => void

	// Config access - returns the proper typed config
	getConfig: () => TaskConfig
}

/**
 * Creates strongly-typed UI helpers from a TaskConfig
 */
export function createUIHelpers(config: TaskConfig, callId?: string): StronglyTypedUIHelpers {
	return {
		say: (type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean, call_id?: string) =>
			config.callbacks.say(type, text, images, files, partial, call_id ?? callId),
		ask: config.callbacks.ask,
		removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => removeClosingTag(block, tag, text),
		removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: ClineAsk | ClineSay, call_id?: string) =>
			config.callbacks.removeLastPartialMessageIfExistsWithType(type, askOrSay, call_id ?? callId),
		shouldAutoApproveTool: (toolName: ClineDefaultTool) => config.autoApprover.shouldAutoApproveTool(toolName),
		shouldAutoApproveToolWithPath: config.callbacks.shouldAutoApproveToolWithPath,
		askApproval: async (messageType: ClineAsk, message: string): Promise<boolean> => {
			const { response } = await config.callbacks.ask(messageType, message, false)
			return response === "yesButtonClicked"
		},
		captureTelemetry: (toolName: ClineDefaultTool, autoApproved: boolean, approved: boolean, isNativeToolCall?: boolean) => {
			// Extract provider information for telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			telemetryService.captureToolUsage(
				config.ulid,
				toolName,
				config.api.getModel().id,
				provider,
				autoApproved,
				approved,
				undefined,
				isNativeToolCall,
			)
		},
		showNotificationIfEnabled: (message: string) => {
			showNotificationForApproval(message, config.autoApprovalSettings.enableNotifications)
		},
		getConfig: () => config,
	}
}
