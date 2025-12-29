import type { ToolParamName, ToolUse } from "@core/assistant-message"

/**
 * Shared constants for tool validation and configuration
 * This file serves as a single source of truth for tool-related constants
 */

/**
 * Expected keys for TaskConfig interface validation
 * Keep this in sync with the TaskConfig interface
 */
export const TASK_CONFIG_KEYS = [
	"taskId",
	"ulid",
	"cwd",
	"mode",
	"strictPlanModeEnabled",
	"yoloModeToggled",
	"vscodeTerminalExecutionMode",
	"enableParallelToolCalling",
	"context",
	"taskState",
	"messageState",
	"api",
	"services",
	"autoApprovalSettings",
	"autoApprover",
	"browserSettings",
	"focusChainSettings",
	"callbacks",
	"coordinator",
] as const

/**
 * Expected keys for TaskServices interface validation
 * Keep this in sync with the TaskServices interface
 */
export const TASK_SERVICES_KEYS = [
	"mcpHub",
	"browserSession",
	"urlContentFetcher",
	"diffViewProvider",
	"fileContextTracker",
	"clineIgnoreController",
	"contextManager",
	"stateManager",
] as const

/**
 * Expected keys for TaskCallbacks interface validation
 * Keep this in sync with the TaskCallbacks interface
 */
export const TASK_CALLBACKS_KEYS = [
	"say",
	"ask",
	"saveCheckpoint",
	"sayAndCreateMissingParamError",
	"removeLastPartialMessageIfExistsWithType",
	"executeCommandTool",
	"doesLatestTaskCompletionHaveNewChanges",
	"updateFCListFromToolResponse",
	"shouldAutoApproveToolWithPath",
	"postStateToWebview",
	"reinitExistingTaskFromId",
	"cancelTask",
	"updateTaskHistory",
	"switchToActMode",
	"setActiveHookExecution",
	"clearActiveHookExecution",
	"getActiveHookExecution",
	"runUserPromptSubmitHook",
] as const

/**
 * Tools that require a path parameter
 * Used for validation in ToolErrorHandler
 */
export const PATH_REQUIRED_TOOLS = [
	"read_file",
	"write_to_file",
	"replace_in_file",
	"new_rule",
	"list_files",
	"list_code_definition_names",
	"search_files",
] as const

/**
 * Browser action types for validation
 */
export const BROWSER_ACTIONS = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const

/**
 * Common validation error patterns
 */
export const VALIDATION_ERROR_PATTERNS = ["Missing required parameter", "blocked by .clineignore"] as const

/**
 * Type helpers for better type safety
 */
export type TaskConfigKey = (typeof TASK_CONFIG_KEYS)[number]
export type TaskServicesKey = (typeof TASK_SERVICES_KEYS)[number]
export type TaskCallbacksKey = (typeof TASK_CALLBACKS_KEYS)[number]
export type PathRequiredTool = (typeof PATH_REQUIRED_TOOLS)[number]
export type BrowserAction = (typeof BROWSER_ACTIONS)[number]

/**
 * Shared utility functions for tools
 */

/**
 * Remove partial closing tag from tool parameter text
 * If block is partial, remove partial closing tag so it's not presented to user
 *
 * This regex dynamically constructs a pattern to match the closing tag:
 * - Optionally matches whitespace before the tag
 * - Matches '<' or '</' optionally followed by any subset of characters from the tag name
 */
export function removeClosingTag(block: ToolUse, tag: ToolParamName, text?: string): string {
	if (!block.partial) {
		return text || ""
	}
	if (!text) {
		return ""
	}

	const tagRegex = new RegExp(
		`\\s?<\/?${tag
			.split("")
			.map((char) => `(?:${char})?`)
			.join("")}$`,
		"g",
	)
	return text.replace(tagRegex, "")
}
