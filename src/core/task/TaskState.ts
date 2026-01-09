import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { ActiveTaskStatus, ClineMessage } from "@shared/ExtensionMessage"
import { ClineAskResponse } from "@shared/WebviewMessage"
import type { HookExecution } from "./types/HookExecution"

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

/**
 * Determines the status of a task based on its state and the last message
 * @param taskState - The TaskState object containing streaming and abort flags
 * @param lastMessage - The last ClineMessage in the conversation (optional)
 * @returns The current ActiveTaskStatus
 */
export function getTaskStatus(taskState?: TaskState, lastMessage?: ClineMessage): ActiveTaskStatus | undefined {
	// Check if task was aborted/cancelled
	if (!taskState || taskState.abort || taskState.abandoned || !lastMessage) {
		return undefined
	}

	const messageType = lastMessage?.say || lastMessage?.ask

	if (!messageType || lastMessage?.partial === true || messageType === "api_req_started" || messageType === "api_req_retried") {
		return "active"
	}

	if (messageType === "api_req_failed" || messageType === "diff_error") {
		return "error"
	}

	// Task is waiting for user input/approval (any ask type that requires response)
	if (lastMessage?.partial === false) {
		if (messageType === "tool" || messageType === "command" || messageType === "followup") {
			return "pending"
		}
	}

	return "done"
}
