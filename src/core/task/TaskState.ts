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
	// Set once we auto-inject the decompose-task nudge on the first mistake-limit hit, so the
	// second hit falls through to a human-in-the-loop ask instead of nudging forever. Reset
	// after a human turn so a later, unrelated stuck-spell also gets one automatic recovery.
	mistakeNudgeAlreadyInjected = false
	// Sliding window of the most recent tool failures (tool name + truncated error), used to
	// ground the auto-decompose nudge in concrete failures instead of generic boilerplate.
	recentToolErrors: string[] = []
	// Semantic loop detection (beyond byte-identical signatures):
	// Consecutive zero-result searches on the SAME target path (regex may vary). Reset on any hit.
	consecutiveZeroResultSearches = 0
	lastZeroResultSearchPath = ""
	// Sliding window of recently read file paths, to catch repeated reads of the same target.
	recentReadTargets: string[] = []
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
