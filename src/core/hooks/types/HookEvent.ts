/**
 * Cline Hook Event Types
 * Maintains 100% compatibility with Claude's hook event structure
 * Reference: https://docs.anthropic.com/en/docs/claude-code/hooks
 */

import { ClineDefaultTool } from "@/shared/tools"

/**
 * Common fields present in all hook events
 * These match Claude's event structure exactly for compatibility
 */
export interface HookEventCommon {
	session_id: string // Maps to Cline's taskId
	transcript_path: string // Path to conversation log
	cwd: string // Current working directory
	hook_event_name: string // Event type name
}

/**
 * PreToolUse event - fired before tool execution
 */
export interface PreToolUseEvent extends HookEventCommon {
	hook_event_name: "PreToolUse"
	tool_name: string
	tool_input: unknown // Structure depends on the specific tool
}

/**
 * PostToolUse event - fired after tool execution
 */
export interface PostToolUseEvent extends HookEventCommon {
	hook_event_name: "PostToolUse"
	tool_name: string
	tool_input: unknown
	tool_response: unknown // Tool execution result
}

/**
 * Notification event - for user notifications
 */
export interface NotificationEvent extends HookEventCommon {
	hook_event_name: "Notification"
	message: string
}

/**
 * UserPromptSubmit event - when user submits a prompt
 */
export interface UserPromptSubmitEvent extends HookEventCommon {
	hook_event_name: "UserPromptSubmit"
	prompt: string
}

/**
 * Stop event - when Cline finishes responding
 */
export interface StopEvent extends HookEventCommon {
	hook_event_name: "Stop"
	stop_hook_active?: boolean
}

/**
 * SubagentStop event - when a subtask finishes
 */
export interface SubagentStopEvent extends HookEventCommon {
	hook_event_name: "SubagentStop"
	stop_hook_active?: boolean
}

/**
 * PreCompact event - before context compaction
 */
export interface PreCompactEvent extends HookEventCommon {
	hook_event_name: "PreCompact"
	trigger: "manual" | "auto"
	custom_instructions?: string
}

/**
 * SessionStart event - when session starts or resumes
 */
export interface SessionStartEvent extends HookEventCommon {
	hook_event_name: "SessionStart"
	source: "startup" | "resume" | "clear"
}

/**
 * SessionEnd event - when a session ends
 */
export interface SessionEndEvent extends HookEventCommon {
	hook_event_name: "SessionEnd"
}

/**
 * Union type of all hook events
 */
export type HookEvent =
	| PreToolUseEvent
	| PostToolUseEvent
	| NotificationEvent
	| UserPromptSubmitEvent
	| StopEvent
	| SubagentStopEvent
	| PreCompactEvent
	| SessionStartEvent
	| SessionEndEvent

/**
 * Hook event names as const for type safety
 */
export const HookEventName = {
	PRE_TOOL_USE: "PreToolUse",
	POST_TOOL_USE: "PostToolUse",
	NOTIFICATION: "Notification",
	USER_PROMPT_SUBMIT: "UserPromptSubmit",
	STOP: "Stop",
	SUBAGENT_STOP: "SubagentStop",
	PRE_COMPACT: "PreCompact",
	SESSION_START: "SessionStart",
	SESSION_END: "SessionEnd",
} as const

export type HookEventNameType = (typeof HookEventName)[keyof typeof HookEventName]

/**
 * Type guards for hook events
 */
export function isPreToolUseEvent(event: unknown): event is PreToolUseEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.PRE_TOOL_USE
}

export function isPostToolUseEvent(event: unknown): event is PostToolUseEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.POST_TOOL_USE
}

export function isNotificationEvent(event: unknown): event is NotificationEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.NOTIFICATION
}

export function isUserPromptSubmitEvent(event: unknown): event is UserPromptSubmitEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.USER_PROMPT_SUBMIT
}

export function isStopEvent(event: unknown): event is StopEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.STOP
}

export function isSubagentStopEvent(event: unknown): event is SubagentStopEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.SUBAGENT_STOP
}

export function isPreCompactEvent(event: unknown): event is PreCompactEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.PRE_COMPACT
}

export function isSessionStartEvent(event: unknown): event is SessionStartEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.SESSION_START
}

export function isSessionEndEvent(event: unknown): event is SessionEndEvent {
	return isHookEvent(event) && event.hook_event_name === HookEventName.SESSION_END
}

/**
 * Base type guard for hook events
 */
export function isHookEvent(event: unknown): event is HookEvent {
	return (
		typeof event === "object" &&
		event !== null &&
		"session_id" in event &&
		"transcript_path" in event &&
		"cwd" in event &&
		"hook_event_name" in event
	)
}

/**
 * Tool name mapping from Cline to Claude-compatible names
 * This ensures hooks work with both Cline and Claude tool names
 */
export const TOOL_NAME_MAP: Record<ClineDefaultTool, string> = {
	[ClineDefaultTool.ASK]: "AskFollowupQuestion",
	[ClineDefaultTool.ATTEMPT]: "AttemptCompletion",
	[ClineDefaultTool.BASH]: "Bash",
	[ClineDefaultTool.FILE_EDIT]: "Edit",
	[ClineDefaultTool.FILE_READ]: "Read",
	[ClineDefaultTool.FILE_NEW]: "Write",
	[ClineDefaultTool.SEARCH]: "Grep",
	[ClineDefaultTool.LIST_FILES]: "Glob",
	[ClineDefaultTool.LIST_CODE_DEF]: "ListCodeDefinitions",
	[ClineDefaultTool.BROWSER]: "BrowserAction",
	[ClineDefaultTool.MCP_USE]: "UseMcpTool",
	[ClineDefaultTool.MCP_ACCESS]: "AccessMcpResource",
	[ClineDefaultTool.MCP_DOCS]: "LoadMcpDocumentation",
	[ClineDefaultTool.NEW_TASK]: "Task",
	[ClineDefaultTool.PLAN_MODE]: "PlanModeRespond",
	[ClineDefaultTool.TODO]: "TodoWrite",
	[ClineDefaultTool.WEB_FETCH]: "WebFetch",
	[ClineDefaultTool.CONDENSE]: "Condense",
	[ClineDefaultTool.SUMMARIZE_TASK]: "SummarizeTask",
	[ClineDefaultTool.REPORT_BUG]: "ReportBug",
	[ClineDefaultTool.NEW_RULE]: "NewRule",
}

/**
 * Get Claude-compatible tool name from Cline tool
 */
export function getClineToolName(clineTool: ClineDefaultTool): string {
	return TOOL_NAME_MAP[clineTool] || clineTool
}
