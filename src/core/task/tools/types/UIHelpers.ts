import type { BeadsmithAsk, BeadsmithSay } from "@shared/ExtensionMessage"
import type { BeadsmithDefaultTool } from "@shared/tools"
import type { BeadsmithAskResponse } from "@shared/WebviewMessage"
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
		type: BeadsmithSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
	) => Promise<number | undefined>

	ask: (
		type: BeadsmithAsk,
		text?: string,
		partial?: boolean,
	) => Promise<{
		response: BeadsmithAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}>

	// Utility methods
	removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => string
	removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: BeadsmithAsk | BeadsmithSay) => Promise<void>

	// Approval methods
	shouldAutoApproveTool: (toolName: BeadsmithDefaultTool) => boolean | [boolean, boolean]
	shouldAutoApproveToolWithPath: (toolName: BeadsmithDefaultTool, path?: string) => Promise<boolean>
	askApproval: (messageType: BeadsmithAsk, message: string) => Promise<boolean>

	// Telemetry and notifications
	captureTelemetry: (
		toolName: BeadsmithDefaultTool,
		autoApproved: boolean,
		approved: boolean,
		isNativeToolCall?: boolean,
	) => void
	showNotificationIfEnabled: (message: string) => void

	// Config access - returns the proper typed config
	getConfig: () => TaskConfig
}

/**
 * Creates strongly-typed UI helpers from a TaskConfig
 */
export function createUIHelpers(config: TaskConfig): StronglyTypedUIHelpers {
	return {
		say: config.callbacks.say,
		ask: config.callbacks.ask,
		removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => removeClosingTag(block, tag, text),
		removeLastPartialMessageIfExistsWithType: config.callbacks.removeLastPartialMessageIfExistsWithType,
		shouldAutoApproveTool: (toolName: BeadsmithDefaultTool) => config.autoApprover.shouldAutoApproveTool(toolName),
		shouldAutoApproveToolWithPath: config.callbacks.shouldAutoApproveToolWithPath,
		askApproval: async (messageType: BeadsmithAsk, message: string): Promise<boolean> => {
			const { response } = await config.callbacks.ask(messageType, message, false)
			return response === "yesButtonClicked"
		},
		captureTelemetry: (
			toolName: BeadsmithDefaultTool,
			autoApproved: boolean,
			approved: boolean,
			isNativeToolCall?: boolean,
		) => {
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
