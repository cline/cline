import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { ClineAskResponse } from "@shared/WebviewMessage"

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

	// ============================================================================
	// HOOK STATE - Dual Architecture for Feature Flag Protection
	// ============================================================================
	// These fields exist in two forms to support both legacy (hooks disabled)
	// and new (hooks enabled) architectures without breaking existing code.

	// LEGACY STRUCTURE (used when hooks feature flag is DISABLED)
	// Single hook execution tracking for cancellation
	activeHookExecution?: {
		hookName: string
		toolName?: string
		messageTs: number
		abortController: AbortController
		scriptPath?: string
	}

	// NEW STRUCTURE (used when hooks feature flag is ENABLED)
	// Multi-hook execution tracking via Map for concurrent hooks
	activeHookExecutions: Map<
		number,
		{
			hookName: string
			toolName?: string
			messageTs: number
			abortController: AbortController
			scriptPath?: string
		}
	> = new Map()

	// NEW ABORT FLOW ENHANCEMENTS (only used when hooks enabled)
	// Single-flight guard to prevent concurrent abortTask() calls
	isAborting: boolean = false
	abortPromise?: Promise<{ waitingAtResumeButton: boolean; abortReason: "user_cancel" | "internal_resume" }>
	// Abort reason to distinguish user cancellation from internal resume flow
	abortReason: "user_cancel" | "internal_resume" = "user_cancel"

	// Session work tracking for TaskCancel hook decision
	// Set to true when substantive work begins (API request, tool execution, user feedback)
	// Used by shouldRunTaskCancelHook() to determine if TaskCancel should run
	// Eliminates race conditions from checking "currently active" work indicators
	didPerformWork: boolean = false

	// Flag to prevent duplicate TaskCancel hook execution
	// Set to true once TaskCancel hook has run, prevents running it again on subsequent abortTask() calls
	didRunTaskCancelHook: boolean = false

	// Auto-context summarization
	currentlySummarizing: boolean = false
	lastAutoCompactTriggerIndex?: number
}
