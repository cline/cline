/**
 * Action buttons component for CLI
 * Shows primary/secondary buttons above the input field
 * Supports keyboard navigation (1/2 for buttons, arrows to navigate, esc to cancel)
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { isFileSaveTool, parseToolFromMessage } from "../utils/tools"

/**
 * Button action types that determine the behavior
 */
export type ButtonActionType =
	| "approve" // Send yesButtonClicked
	| "reject" // Send noButtonClicked
	| "proceed" // Send messageResponse or yesButtonClicked
	| "new_task" // Start a new task
	| "cancel" // Cancel streaming
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
 */
const BUTTON_CONFIGS: Record<string, ButtonConfig> = {
	// Error recovery states
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

	// Tool approval states
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
		secondaryText: "Exit",
		primaryAction: "new_task",
		secondaryAction: "reject",
	},
	resume_task: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Resume Task",
		secondaryText: "Exit",
		primaryAction: "proceed",
		secondaryAction: "reject",
	},
	resume_completed_task: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Start New Task",
		secondaryText: "Exit",
		primaryAction: "new_task",
		secondaryAction: "reject",
	},
	new_task: {
		sendingDisabled: false,
		enableButtons: true,
		primaryText: "Start New Task with Context",
		secondaryText: "Exit",
		primaryAction: "new_task",
		secondaryAction: "reject",
	},

	// Streaming/partial states
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
 * Get button configuration based on message type and state
 */
export function getButtonConfig(message: ClineMessage | undefined, isStreaming: boolean = false): ButtonConfig {
	if (!message) {
		return BUTTON_CONFIGS.default
	}

	const isError = message?.ask ? errorTypes.includes(message.ask) : false

	// Special case: command_output should show "Proceed While Running" button even while streaming
	if (message.type === "ask" && message.ask === "command_output") {
		return BUTTON_CONFIGS.command_output
	}

	// Handle partial/streaming messages first
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
				const toolInfo = parseToolFromMessage(message.text)
				if (toolInfo && isFileSaveTool(toolInfo.toolName)) {
					return BUTTON_CONFIGS.tool_save
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

			default:
				return BUTTON_CONFIGS.tool_approve
		}
	}

	// Handle say messages
	if (message.type === "say" && message.say === "api_req_started") {
		return BUTTON_CONFIGS.api_req_active
	}

	if (message.type === "say" && message.say === "command_output") {
		return BUTTON_CONFIGS.command_output
	}

	return BUTTON_CONFIGS.partial
}

interface ActionButtonsProps {
	config: ButtonConfig
	mode?: "act" | "plan"
}

/**
 * Determine which buttons are actually visible based on config
 * Cancel is hidden in the CLI (ThinkingIndicator handles that with esc)
 */
export function getVisibleButtons(config: ButtonConfig) {
	const hiddenActions = ["cancel"]
	const hasPrimary = !!config.primaryText && !hiddenActions.includes(config.primaryAction || "")
	const hasSecondary = !!config.secondaryText && !hiddenActions.includes(config.secondaryAction || "")
	return { hasPrimary, hasSecondary }
}

/**
 * Action buttons component
 * Shows primary and/or secondary buttons based on config
 * Buttons take full width (one button = full, two buttons = half each)
 * Does not show cancel-only buttons (ThinkingIndicator handles that with esc)
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({ config, mode = "act" }) => {
	if (!config.enableButtons) {
		return null
	}

	const { hasPrimary, hasSecondary } = getVisibleButtons(config)

	if (!hasPrimary && !hasSecondary) {
		return null
	}

	// Calculate button widths based on terminal width
	const { columns: terminalWidth } = useTerminalSize()
	const buttonCount = (hasPrimary ? 1 : 0) + (hasSecondary ? 1 : 0)
	const gapWidth = buttonCount > 1 ? 1 : 0 // 1 char gap between buttons
	const availableWidth = terminalWidth - 2 - gapWidth // 1 space padding on each side
	const buttonWidth = Math.floor(availableWidth / buttonCount)

	const modeColor = mode === "plan" ? "yellow" : COLORS.primaryBlue

	const renderButton = (text: string, shortcut: string) => {
		const label = ` ${text} (${shortcut}) `
		const padding = Math.max(0, buttonWidth - label.length)
		const leftPad = Math.floor(padding / 2)
		const rightPad = padding - leftPad
		const paddedLabel = " ".repeat(leftPad) + label + " ".repeat(rightPad)

		return (
			<Text backgroundColor={modeColor} color="black">
				{paddedLabel}
			</Text>
		)
	}

	return (
		<Box flexDirection="row" gap={1} marginLeft={1} width="100%">
			{hasPrimary && renderButton(config.primaryText!, "1")}
			{hasSecondary && renderButton(config.secondaryText!, hasPrimary ? "2" : "1")}
		</Box>
	)
}
