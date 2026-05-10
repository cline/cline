import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { AiHydroAskResponse } from "@shared/WebviewMessage"

export class TaskState {
	// Streaming flags
	isStreaming = false
	isWaitingForFirstChunk = false
	didCompleteReadingStream = false

	// Content processing
	currentStreamingContentIndex = 0
	assistantMessageContent: AssistantMessageContent[] = []
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
	userMessageContentReady = false

	// Presentation locks
	presentAssistantMessageLocked = false
	presentAssistantMessageHasPendingUpdates = false

	// Ask/Response handling
	askResponse?: AiHydroAskResponse
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

	// Consecutive request tracking
	consecutiveAutoApprovedRequestsCount: number = 0

	// Error tracking
	consecutiveMistakeCount: number = 0
	lastToolName = "" // Name of the last executed tool
	lastToolParams = "" // Canonical signature of last tool's params (via toolCallSignature)
	consecutiveIdenticalToolCount = 0 // Consecutive calls with identical tool name + params
	// File read deduplication cache — prevents the model from endlessly reading the same files
	fileReadCache: Map<string, { readCount: number; mtime: number; imageBlock?: Anthropic.ImageBlockParam }> = new Map()
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

	// Auto-context summarization
	currentlySummarizing: boolean = false
	lastAutoCompactTriggerIndex?: number

	// RAG Brain integration
	hasPromptedForRagInstall: boolean = false
}
