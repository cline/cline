import type { Anthropic } from "@anthropic-ai/sdk";
import type { AssistantMessageContent } from "@core/assistant-message";
import type { ClineAskResponse } from "@shared/WebviewMessage";
import type { HookExecution } from "./types/HookExecution";

export class TaskState {
	// Task-level timing
	taskStartTimeMs = Date.now();
	taskFirstTokenTimeMs?: number;

	// Streaming flags
	isStreaming = false;
	isWaitingForFirstChunk = false;
	didCompleteReadingStream = false;

	// Content processing
	currentStreamingContentIndex = 0;
	assistantMessageContent: AssistantMessageContent[] = [];
	userMessageContent: (
		| Anthropic.TextBlockParam
		| Anthropic.ImageBlockParam
		| Anthropic.ToolResultBlockParam
	)[] = [];
	userMessageContentReady = false;
	// Map of tool names to their tool_use_id for creating proper ToolResultBlockParam
	toolUseIdMap: Map<string, string> = new Map();

	// Presentation locks
	presentAssistantMessageLocked = false;
	presentAssistantMessageHasPendingUpdates = false;

	// Ask/Response handling
	askResponse?: ClineAskResponse;
	askResponseText?: string;
	askResponseImages?: string[];
	askResponseFiles?: string[];
	lastMessageTs?: number;

	// Plan mode specific state
	isAwaitingPlanResponse = false;
	didRespondToPlanAskBySwitchingMode = false;

	// Context and history
	conversationHistoryDeletedRange?: [number, number];

	// Tool execution flags
	didRejectTool = false;
	didAlreadyUseTool = false;
	didEditFile = false;
	lastToolName = ""; // Track last tool used for consecutive call detection
	lastToolParams = ""; // Canonical signature of last tool's params (via toolCallSignature)
	consecutiveIdenticalToolCount = 0; // Consecutive calls with identical tool name + params

	// File read deduplication cache - prevents the model from endlessly reading the same files
	// Maps absolute file path → { readCount: times read in this task, mtime: last modified timestamp, imageBlock: optional image data for multimodal models }
	fileReadCache: Map<
		string,
		{ readCount: number; mtime: number; imageBlock?: Anthropic.ImageBlockParam }
	> = new Map();

	// Error tracking
	private _consecutiveMistakeCount = 0;
	/**
	 * How many of the current consecutive-mistake streak came from narration-only
	 * turns (assistant responded with no tool_use). Used so the mistake-limit UI
	 * can say "no tool invocation" instead of "tool call failures" (#12431).
	 */
	consecutiveNoToolMistakeCount = 0;
	/** When true, the next consecutiveMistakeCount increment is from a no-tool turn. */
	private expectingNoToolMistake = false;

	get consecutiveMistakeCount(): number {
		return this._consecutiveMistakeCount;
	}

	set consecutiveMistakeCount(value: number) {
		if (value === 0) {
			this._consecutiveMistakeCount = 0;
			this.consecutiveNoToolMistakeCount = 0;
			return;
		}
		const prev = this._consecutiveMistakeCount;
		this._consecutiveMistakeCount = value;
		// Tool-handler increments (`count++`) and forced jumps (loop detection
		// assigning max) break a pure no-tool streak. no-tool increments go
		// through recordNoToolMistake() which sets expectingNoToolMistake.
		if (!this.expectingNoToolMistake) {
			this.consecutiveNoToolMistakeCount = 0;
		} else if (value < prev) {
			this.consecutiveNoToolMistakeCount = Math.min(
				this.consecutiveNoToolMistakeCount,
				value,
			);
		}
	}

	/** Record a recoverable mistake caused by a narration-only (no tool_use) turn. */
	recordNoToolMistake(): void {
		this.expectingNoToolMistake = true;
		try {
			this.consecutiveMistakeCount++;
			this.consecutiveNoToolMistakeCount++;
		} finally {
			this.expectingNoToolMistake = false;
		}
	}

	/** True when every mistake in the current streak was a no-tool turn. */
	get isConsecutiveMistakeStreakFromNoTools(): boolean {
		return (
			this._consecutiveMistakeCount > 0 &&
			this.consecutiveNoToolMistakeCount >= this._consecutiveMistakeCount
		);
	}

	doubleCheckCompletionPending = false;
	didAutomaticallyRetryFailedApiRequest = false;
	checkpointManagerErrorMessage?: string;

	// Retry tracking for auto-retry feature
	autoRetryAttempts = 0;

	// Task Initialization
	isInitialized = false;

	// Focus Chain / Todo List Management
	apiRequestCount = 0;
	apiRequestsSinceLastTodoUpdate = 0;
	currentFocusChainChecklist: string | null = null;
	todoListWasUpdatedByUser = false;

	// Task Abort / Cancellation
	abort = false;
	didFinishAbortingStream = false;
	abandoned = false;

	// Hook execution tracking for cancellation
	activeHookExecution?: HookExecution;

	// Auto-context summarization
	currentlySummarizing = false;
	lastAutoCompactTriggerIndex?: number;
}
