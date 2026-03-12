import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { ClineAskResponse } from "@shared/WebviewMessage"
import type { HookExecution } from "./types/HookExecution"

export class TaskState {
	// Task-level timing
	taskStartTimeMs = Date.now()
	taskFirstTokenTimeMs?: number
	isRemoteWorkspace = false

	// Request-scoped performance metrics
	presentationMetrics = {
		requestStartedAtMs: 0,
		invocationCount: 0,
		totalDurationMs: 0,
		triggerCounts: {
			text: 0,
			reasoning: 0,
			tool: 0,
			finalization: 0,
			other: 0,
		},
	}
	statePostMetrics = {
		requestStartedAtMs: 0,
		callCount: 0,
		coalescedCallCount: 0,
		stateBuildDurationMs: 0,
		serializedBytes: 0,
		sendDurationMs: 0,
	}
	partialMessageMetrics = {
		requestStartedAtMs: 0,
		eventCount: 0,
		payloadBytes: 0,
		broadcastDurationMs: 0,
	}
	persistenceMetrics = {
		requestStartedAtMs: 0,
		saveMessagesDurationMs: 0,
		saveConversationDurationMs: 0,
		updateHistoryDurationMs: 0,
		flushCount: 0,
	}
	chunkToWebviewMetrics = {
		requestStartedAtMs: 0,
		chunkCount: 0,
		lastChunkReceivedAtMs: 0,
		lastWebviewFlushCompletedAtMs: 0,
		observedDelaysMs: [] as number[],
	}

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
	didEditFile = false
	lastToolName = "" // Track last tool used for consecutive call detection

	// Error tracking
	consecutiveMistakeCount = 0
	doubleCheckCompletionPending = false
	didAutomaticallyRetryFailedApiRequest = false
	checkpointManagerErrorMessage?: string

	// Retry tracking for auto-retry feature
	autoRetryAttempts = 0

	// Task Initialization
	isInitialized = false

	// Focus Chain / Todo List Management
	apiRequestCount = 0
	apiRequestsSinceLastTodoUpdate = 0
	currentFocusChainChecklist: string | null = null
	todoListWasUpdatedByUser = false

	// Task Abort / Cancellation
	abort = false
	didFinishAbortingStream = false
	abandoned = false

	// Hook execution tracking for cancellation
	activeHookExecution?: HookExecution

	// Auto-context summarization
	currentlySummarizing = false
	lastAutoCompactTriggerIndex?: number
}
