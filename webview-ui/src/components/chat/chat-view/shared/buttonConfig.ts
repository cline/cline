import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"

/**
 * Button action types that determine the behavior
 */
export type ButtonActionType =
	| "approve" // Send yesButtonClicked
	| "reject" // Send noButtonClicked
	| "proceed" // Send messageResponse or yesButtonClicked
	| "new_task" // Start a new task
	| "cancel" // Cancel streaming
	| "utility" // Execute utility function (condense, report_bug)
	| "retry" // Retry the last action

/**
 * Button configuration for different message states
 */
export interface ButtonConfig {
	sendingDisabled: boolean
	enableButtons: boolean
	primaryText?: string
	secondaryText?: string
	primaryAction?: ButtonActionType
	secondaryAction?: ButtonActionType
}

/**
 * Centralized button state configurations based on task lifecycle
 * This is the single source of truth for both button display and actions
 */
export const BUTTON_CONFIGS: Record<string, ButtonConfig> = {
	// Error recovery states - user must take action
	api_req_failed: {
		sendingDisabled: true,
		enableButtons: true,
		primaryText: "Retry",
		secondaryText: "Start New Task",
		primaryAction: "retry",
		secondaryAction: "new_task",
	},
	mistake_limit_reached: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Proceed Anyways",
		secondaryText: "Start New Task",
		primaryAction: "proceed",
		secondaryAction: "new_task",
	},

	// Tool approval states - most common during task execution
	tool_approve: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Approve",
		secondaryText: "Reject",
		primaryAction: "approve",
		secondaryAction: "reject",
	},
	tool_save: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Save",
		secondaryText: "Reject",
		primaryAction: "approve",
		secondaryAction: "reject",
	},

	// Command execution states
	command: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Run Command",
		secondaryText: "Reject",
		primaryAction: "approve",
		secondaryAction: "reject",
	},
	command_output: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Proceed While Running",
		secondaryText: undefined,
		primaryAction: "proceed",
		secondaryAction: undefined,
	},

	// Browser and external tool states
	browser_action_launch: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Approve",
		secondaryText: "Reject",
		primaryAction: "approve",
		secondaryAction: "reject",
	},
	use_mcp_server: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Approve",
		secondaryText: "Reject",
		primaryAction: "approve",
		secondaryAction: "reject",
	},
	followup: {
		sendingDisabled: false,
		enableButtons: false,
		primaryText: undefined,
		secondaryText: undefined,
		primaryAction: undefined,
		secondaryAction: undefined,
	},
	plan_mode_respond: {
		sendingDisabled: false,
		enableButtons: false,
		primaryText: undefined,
		secondaryText: undefined,
		primaryAction: undefined,
		secondaryAction: undefined,
	},

	// Task lifecycle states
	completion_result: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Start New Task",
		secondaryText: undefined,
		primaryAction: "new_task",
		secondaryAction: undefined,
	},
	resume_task: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Resume Task",
		secondaryText: undefined,
		primaryAction: "proceed",
		secondaryAction: undefined,
	},
	resume_completed_task: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Start New Task",
		secondaryText: undefined,
		primaryAction: "new_task",
		secondaryAction: undefined,
	},
	new_task: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Start New Task with Context",
		secondaryText: undefined,
		primaryAction: "new_task",
		secondaryAction: undefined,
	},

	// Utility states
	condense: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Condense Conversation",
		secondaryText: undefined,
		primaryAction: "utility",
		secondaryAction: undefined,
	},
	report_bug: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Report GitHub issue",
		secondaryText: undefined,
		primaryAction: "utility",
		secondaryAction: undefined,
	},

	// Streaming/partial states - disable interaction during streaming
	partial: {
		sendingDisabled: true,
		enableButtons: true,
		primaryText: undefined,
		secondaryText: "Cancel",
		primaryAction: undefined,
		secondaryAction: "cancel",
	},

	// Default states
	default: {
		sendingDisabled: false,
		enableButtons: false,
		primaryText: undefined,
		secondaryText: undefined,
		primaryAction: undefined,
		secondaryAction: undefined,
	},
	api_req_active: {
		sendingDisabled: true,
		enableButtons: true,
		primaryText: undefined,
		secondaryText: "Cancel",
		primaryAction: undefined,
		secondaryAction: "cancel",
	},
}

const errorTypes = ["api_req_failed", "mistake_limit_reached"]

/**
 * Determines button configuration based on message type and state
 * This is the single source of truth used by both ActionButtons and useMessageHandlers
 */
export function getButtonConfig(message: ClineMessage | undefined, _mode: Mode = "act"): ButtonConfig {
	if (!message) {
		return BUTTON_CONFIGS.default
	}

	const isStreaming = message.partial === true
	const isError = message?.ask ? errorTypes.includes(message.ask) : false

	// Special case: command_output should show "Proceed While Running" button even while streaming
	// This allows terminal output to stream while still showing the action button
	if (message.type === "ask" && message.ask === "command_output") {
		return BUTTON_CONFIGS.command_output
	}

	// Handle partial/streaming messages first (most common during task execution)
	// This must be checked before any other conditions to ensure streaming state takes precedence
	if (isStreaming && !isError) {
		return BUTTON_CONFIGS.partial
	}

	// Handle ask messages (user interaction required)
	if (message.type === "ask") {
		switch (message.ask) {
			// Error recovery states
			case "api_req_failed":
				return BUTTON_CONFIGS.api_req_failed
			case "mistake_limit_reached":
				return BUTTON_CONFIGS.mistake_limit_reached

			// Tool approval (most common)
			case "tool": {
				// Only parse JSON if we need to determine save vs approve
				try {
					const tool = JSON.parse(message.text || "{}") as ClineSayTool
					if (tool.tool === "editedExistingFile" || tool.tool === "newFileCreated" || tool.tool === "fileDeleted") {
						return BUTTON_CONFIGS.tool_save
					}
				} catch {
					// Fall through to default tool approval
				}
				return BUTTON_CONFIGS.tool_approve
			}

			// Command execution
			case "command":
				return BUTTON_CONFIGS.command
			case "command_output":
				return BUTTON_CONFIGS.command_output

			// Standard approvals
			case "followup":
				return BUTTON_CONFIGS.followup
			case "browser_action_launch":
				return BUTTON_CONFIGS.browser_action_launch
			case "use_mcp_server":
				return BUTTON_CONFIGS.use_mcp_server
			case "plan_mode_respond":
				return BUTTON_CONFIGS.plan_mode_respond

			// Task lifecycle
			case "completion_result":
				return BUTTON_CONFIGS.completion_result
			case "resume_task":
				return BUTTON_CONFIGS.resume_task
			case "resume_completed_task":
				return BUTTON_CONFIGS.resume_completed_task
			case "new_task":
				return BUTTON_CONFIGS.new_task

			// Utility
			case "condense":
				return BUTTON_CONFIGS.condense
			case "report_bug":
				return BUTTON_CONFIGS.report_bug

			default:
				return BUTTON_CONFIGS.tool_approve
		}
	}

	// Handle say messages (typically don't require buttons except in special cases)
	if (message.type === "say" && message.say === "api_req_started") {
		return BUTTON_CONFIGS.api_req_active
	}

	// Special case: command_output say messages should show "Proceed While Running" button
	// This allows terminal output to stream while still showing the action button
	if (message.type === "say" && message.say === "command_output") {
		return BUTTON_CONFIGS.command_output
	}

	return BUTTON_CONFIGS.partial
}
