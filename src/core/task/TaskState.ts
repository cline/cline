import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { ActiveTaskStatus, ClineMessage } from "@shared/ExtensionMessage"
import { ClineAskResponse } from "@shared/WebviewMessage"
import type { HookExecution } from "./types/HookExecution"

/**
 * Determines the status of a task based on its state and the last message
 * @param taskState - The TaskState object containing streaming and abort flags
 * @param lastMessage - The last ClineMessage in the conversation (optional)
 * @returns The current ActiveTaskStatus
 */
export function getTaskStatus(taskState: TaskState, lastMessage?: ClineMessage): ActiveTaskStatus {
	// Check if task is actively streaming
	if (taskState.isStreaming || taskState.isWaitingForFirstChunk || lastMessage?.partial) {
		return "active"
	}

	// Check if task was aborted/cancelled
	if (taskState.abort || taskState.abandoned) {
		// If showing resume button after cancellation, it's cancelled
		if (lastMessage?.ask === "resume_task" || lastMessage?.ask === "resume_completed_task") {
			return "cancelled"
		}
		return "cancelled"
	}

	// Check last message for specific states
	if (lastMessage) {
		// Task completed successfully - showing completion result or resume_completed_task
		if (lastMessage.ask === "completion_result" || lastMessage.ask === "resume_completed_task") {
			return "done"
		}

		// Task has an error - API request failed
		if (lastMessage.ask === "api_req_failed") {
			return "error"
		}

		// Task is waiting for user input/approval (any ask type that requires response)
		if (lastMessage.type === "ask" && !lastMessage.partial) {
			// These are pending states waiting for user action
			const pendingAskTypes = [
				"followup",
				"plan_mode_respond",
				"act_mode_respond",
				"command",
				"command_output",
				"tool",
				"mistake_limit_reached",
				"browser_action_launch",
				"use_mcp_server",
				"new_task",
				"condense",
				"summarize_task",
				"report_bug",
				"resume_task", // Waiting to resume
			]
			if (pendingAskTypes.includes(lastMessage.ask!)) {
				return "pending"
			}
		}
	}

	// Default to pending if task is initialized but not actively doing anything
	if (taskState.isInitialized && !taskState.isStreaming) {
		return "pending"
	}

	// Fallback - task is active if none of the above conditions match
	return "active"
}

export class TaskState {
	// Streaming flags
	isStreaming = false
	isWaitingForFirstChunk = false
	didCompleteReadingStream = false

	// Content processing
	currentStreamingContentIndex = 0
	assistantMessageContent: AssistantMessageContent[] = []
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam)[] = []
	userMessageContentReady = false
	// Map of tool names to their tool_use_id for creating proper ToolResultBlockParam
	toolUseIdMap: Map<string, string> = new Map()

	// Presentation locks
	presentAssistantMessageLocked = false
	presentAssistantMessageHasPendingUpdates = false

	// Ask/Response handling
	askResponse?: ClineAskResponse
	askResponseText?: string
	askResponseImages?: string[]
	askResponseFiles?: string[]
	lastMessageTs?: number

	// Plan mode specific state
	isAwaitingPlanResponse = false
	didRespondToPlanAskBySwitchingMode = false

	// Context and history
	conversationHistoryDeletedRange?: [number, number]

	// Tool execution flags
	didRejectTool = false
	didAlreadyUseTool = false
	didEditFile: boolean = false

	// Error tracking
	consecutiveMistakeCount: number = 0
	didAutomaticallyRetryFailedApiRequest = false
	checkpointManagerErrorMessage?: string

	// Retry tracking for auto-retry feature
	autoRetryAttempts: number = 0

	// Task Initialization
	isInitialized = false

	// Focus Chain / Todo List Management
	apiRequestCount: number = 0
	apiRequestsSinceLastTodoUpdate: number = 0
	currentFocusChainChecklist: string | null = null
	todoListWasUpdatedByUser: boolean = false

	// Task Abort / Cancellation
	abort: boolean = false
	didFinishAbortingStream = false
	abandoned = false

	// Hook execution tracking for cancellation
	activeHookExecution?: HookExecution

	// Auto-context summarization
	currentlySummarizing: boolean = false
	lastAutoCompactTriggerIndex?: number
}
