/**
 * Event Transformer
 * Transforms Cline's internal events to Claude-compatible hook format
 */

import { ToolUse } from "@core/assistant-message"
import { ClineDefaultTool } from "@/shared/tools"
import {
	getClineToolName,
	HookEventCommon,
	NotificationEvent,
	PostToolUseEvent,
	PreCompactEvent,
	PreToolUseEvent,
	SessionEndEvent,
	SessionStartEvent,
	StopEvent,
	SubagentStopEvent,
	UserPromptSubmitEvent,
} from "./types/HookEvent"

export class EventTransformer {
	private taskId: string
	private cwd: string
	private transcriptPath?: string

	constructor(taskId: string, cwd: string, transcriptPath?: string) {
		this.taskId = taskId
		this.cwd = cwd
		this.transcriptPath = transcriptPath
	}

	/**
	 * Update the transcript path (may be set after initialization)
	 */
	setTranscriptPath(path: string): void {
		this.transcriptPath = path
	}

	/**
	 * Create common fields for all events
	 */
	private createCommonFields(eventName: string): HookEventCommon {
		return {
			session_id: this.taskId,
			transcript_path: this.transcriptPath || "",
			cwd: this.cwd,
			hook_event_name: eventName,
		}
	}

	/**
	 * Transform a PreToolUse event
	 */
	createPreToolUseEvent(toolBlock: ToolUse): PreToolUseEvent {
		const toolName = getClineToolName(toolBlock.name as ClineDefaultTool)
		return {
			...this.createCommonFields("PreToolUse"),
			hook_event_name: "PreToolUse" as const,
			tool_name: toolName,
			tool_input: EventTransformer.extractToolInput(toolBlock),
		}
	}

	/**
	 * Transform a PostToolUse event
	 */
	createPostToolUseEvent(toolBlock: ToolUse, toolResponse: unknown): PostToolUseEvent {
		const toolName = getClineToolName(toolBlock.name as ClineDefaultTool)
		return {
			...this.createCommonFields("PostToolUse"),
			hook_event_name: "PostToolUse" as const,
			tool_name: toolName,
			tool_input: EventTransformer.extractToolInput(toolBlock),
			tool_response: toolResponse,
		}
	}

	/**
	 * Create a UserPromptSubmit event
	 */
	createUserPromptSubmitEvent(prompt: string): UserPromptSubmitEvent {
		return {
			...this.createCommonFields("UserPromptSubmit"),
			hook_event_name: "UserPromptSubmit" as const,
			prompt,
		}
	}

	/**
	 * Create a Notification event
	 */
	createNotificationEvent(message: string): NotificationEvent {
		return {
			...this.createCommonFields("Notification"),
			hook_event_name: "Notification" as const,
			message,
		}
	}

	/**
	 * Create a Stop event
	 */
	createStopEvent(stopHookActive: boolean = false): StopEvent {
		return {
			...this.createCommonFields("Stop"),
			hook_event_name: "Stop" as const,
			stop_hook_active: stopHookActive,
		}
	}

	/**
	 * Create a SubagentStop event
	 */
	createSubagentStopEvent(stopHookActive: boolean = false): SubagentStopEvent {
		return {
			...this.createCommonFields("SubagentStop"),
			hook_event_name: "SubagentStop" as const,
			stop_hook_active: stopHookActive,
		}
	}

	/**
	 * Create a PreCompact event
	 */
	createPreCompactEvent(trigger: "manual" | "auto", customInstructions?: string): PreCompactEvent {
		const event: PreCompactEvent = {
			...this.createCommonFields("PreCompact"),
			hook_event_name: "PreCompact" as const,
			trigger,
		}
		if (customInstructions) {
			event.custom_instructions = customInstructions
		}
		return event
	}

	/**
	 * Create a SessionStart event
	 */
	createSessionStartEvent(source: "startup" | "resume" | "clear"): SessionStartEvent {
		return {
			...this.createCommonFields("SessionStart"),
			hook_event_name: "SessionStart" as const,
			source,
		}
	}

	/**
	 * Create a SessionEnd event
	 */
	createSessionEndEvent(): SessionEndEvent {
		return {
			...this.createCommonFields("SessionEnd"),
			hook_event_name: "SessionEnd" as const,
		}
	}

	/**
	 * Extract tool input in a format suitable for hooks
	 * Handles different Cline tool input formats
	 */
	static extractToolInput(toolBlock: ToolUse): unknown {
		const params = toolBlock.params

		// Handle different tool input formats
		switch (toolBlock.name) {
			case ClineDefaultTool.FILE_READ:
				return {
					path: params.path,
				}

			case ClineDefaultTool.FILE_NEW:
			case ClineDefaultTool.FILE_EDIT:
				return {
					path: params.path,
					content: params.content || params.diff,
				}

			case ClineDefaultTool.BASH:
				return {
					command: params.command,
				}

			case ClineDefaultTool.SEARCH:
				return {
					path: params.path,
					regex: params.regex,
					file_pattern: params.file_pattern,
				}

			case ClineDefaultTool.LIST_FILES:
				return {
					path: params.path,
					recursive: params.recursive,
				}

			case ClineDefaultTool.WEB_FETCH:
				return {
					url: params.url,
				}

			default:
				// Return raw params for other tools
				return params
		}
	}

	/**
	 * Transform tool response to a format suitable for hooks
	 */
	static transformToolResponse(response: unknown): unknown {
		// If response is a string, wrap it in an object
		if (typeof response === "string") {
			return {
				output: response,
			}
		}

		// If response is an array (e.g., image blocks), convert to object
		if (Array.isArray(response)) {
			return {
				blocks: response,
			}
		}

		// Return as-is for objects
		return response
	}
}
