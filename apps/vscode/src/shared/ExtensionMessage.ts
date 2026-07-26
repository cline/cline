// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or 'settingsButtonClicked' or 'hello'

import { WorkspaceRoot } from "@shared/multi-root/types"
import { ApiConfiguration } from "./api"
import { BrowserSettings } from "./BrowserSettings"
import { BedrockCoderRulesToggles } from "./bedrock-coder-rules"
import type { BedrockStartupState } from "./bedrock-startup"
import type { Environment } from "./config-types"
import { HistoryItem } from "./HistoryItem"
import { McpDisplayMode } from "./McpDisplayMode"
import { BedrockCoderMessageModelInfo } from "./messages"
import { Mode } from "./storage/types"
// webview will hold state
export interface ExtensionMessage {
	type: "grpc_response" // New type for gRPC responses
	grpc_response?: GrpcResponse
}

export type GrpcResponse = {
	message?: any // JSON serialized protobuf message
	request_id: string // Same ID as the request
	error?: string // Optional error message
	is_streaming?: boolean // Whether this is part of a streaming response
	sequence_number?: number // For ordering chunks in streaming responses
}

export type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "unknown"

export const DEFAULT_PLATFORM = "unknown"

export const COMMAND_CANCEL_TOKEN = "__bedrockCoder_command_cancel__"
export interface ExtensionState {
	isNewUser: boolean
	welcomeViewCompleted: boolean
	apiConfiguration?: ApiConfiguration
	bedrockStartup?: BedrockStartupState
	browserSettings: BrowserSettings
	remoteBrowserHost?: string
	preferredLanguage?: string
	mode: Mode
	bedrockCoderMessages: BedrockCoderMessage[]
	checkpointRestoreInput?: {
		text: string
		images?: string[]
		files?: string[]
		sessionId: string
	}
	/**
	 * The single authoritative UI mode for the current turn, owned by the extension. The webview
	 * renders the footer/buttons/thinking indicator from this, NOT from the tail of bedrockCoderMessages.
	 * Optional for classic/legacy (absent => webview falls back to legacy tail heuristics).
	 */
	turnState?: TurnState
	/** One authoritative extension-host lifecycle for the current/most recent agent run. */
	runState?: AgentRunState
	/**
	 * Follow-up prompts submitted while the active agent turn is still running.
	 * These are owned by the SDK pending-prompt queue and are sent after the
	 * current turn reaches a safe continuation point.
	 */
	queuedPrompts?: QueuedPrompt[]
	/**
	 * Monotonic version of this state snapshot. The webview applies a snapshot only if its
	 * stateVersion is newer than the last applied, so stale/out-of-order state pushes are
	 * ignored. Stamped by the extension. Optional for classic/legacy.
	 */
	stateVersion?: number
	/**
	 * Conversation/replica fence for this snapshot (see BedrockCoderMessage.epoch). A snapshot with a
	 * newer epoch replaces the webview transcript; an older one is dropped; an equal one merges.
	 * Optional for classic/legacy.
	 */
	epoch?: number
	currentTaskItem?: HistoryItem
	mcpDisplayMode: McpDisplayMode
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting?: boolean
	platform: Platform
	environment?: Environment
	taskHistory: HistoryItem[]
	shellIntegrationTimeout: number
	terminalReuseEnabled?: boolean
	maxConsecutiveMistakes: number
	defaultTerminalProfile?: string
	vscodeTerminalExecutionMode: string
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	/**
	 * True while a foreground (VS Code terminal) command is awaited by a
	 * run_commands tool call. Drives the "Proceed While Running" button.
	 */
	foregroundCommandRunning?: boolean
	lastCompletedCommandTs?: number
	version: string
	globalBedrockCoderRulesToggles: BedrockCoderRulesToggles
	localBedrockCoderRulesToggles: BedrockCoderRulesToggles
	localWorkflowToggles: BedrockCoderRulesToggles
	globalWorkflowToggles: BedrockCoderRulesToggles
	localCursorRulesToggles: BedrockCoderRulesToggles
	localWindsurfRulesToggles: BedrockCoderRulesToggles
	localAgentsRulesToggles: BedrockCoderRulesToggles
	mcpResponsesCollapsed?: boolean
	useAutoCondense?: boolean
	compactionStrategy?: string
	subagentsEnabled?: boolean
	worktreesEnabled?: boolean
	customPrompt?: string
	favoritedModelIds: string[]
	// NEW: Add workspace information
	workspaceRoots: WorkspaceRoot[]
	primaryRootIndex: number
	isMultiRootWorkspace: boolean
	multiRootSetting: boolean
	lastDismissedInfoBannerVersion: number
	lastDismissedModelBannerVersion: number
	lastDismissedCliBannerVersion: number
	hooksEnabled?: boolean
	globalSkillsToggles?: Record<string, boolean>
	localSkillsToggles?: Record<string, boolean>
	showFeatureTips?: boolean
}

/**
 * The authoritative UI mode for the current agent turn, owned by the extension. The webview reads
 * this instead of inferring mode from the tail of bedrockCoderMessages.
 */
export type TurnPhase =
	| "idle" // no active turn; input enabled, no buttons
	| "streaming" // model producing content / tool running; Thinking + Cancel
	| "awaiting_approval" // a tool/command/mcp/subagent approval is pending
	| "awaiting_followup" // ask_question / plan_mode_respond / done-without-completion
	| "completed" // attempt_completion done; Start New Task
	| "error" // api_req_failed / fatal; Retry / recovery
	| "resumable" // task cancelled / interrupted; Resume Task

export interface TurnState {
	phase: TurnPhase
	/** ts of the BedrockCoderMessage this phase is "about" (e.g. the pending approval/ask). */
	anchorTs?: number
	/** Monotonic; the webview keeps the highest-seq TurnState and ignores older ones. */
	seq: number
}

export type AgentRunPhase =
	| "idle"
	| "submitting"
	| "awaitingFirstEvent"
	| "streaming"
	| "waitingForApproval"
	| "runningTool"
	| "cancelling"
	| "completed"
	| "cancelled"
	| "failed"

export interface AgentRunFailure {
	source: "stream" | "tool" | "approval" | "rendering" | "persistence"
	category?: string
	code?: string
	httpStatus?: number
	requestId?: string
	message: string
	details?: string
	retrySafe: boolean
}

export interface AgentRunState {
	phase: AgentRunPhase
	seq: number
	runId?: string
	sessionId?: string
	startedAt?: number
	stageStartedAt: number
	invocationId?: string
	currentToolName?: string
	failure?: AgentRunFailure
	metrics?: {
		requestSentAt?: number
		firstEventAt?: number
		firstRenderedAt?: number
		cancellationRequestedAt?: number
		terminalAt?: number
		requestToFirstEventMs?: number
		firstEventToFirstRenderedMs?: number
		cancellationToTerminalMs?: number
	}
}

export interface QueuedPrompt {
	id: string
	prompt: string
	delivery: "queue" | "steer"
	attachmentCount: number
}

export interface BedrockCoderMessage {
	ts: number
	type: "ask" | "say"
	ask?: BedrockCoderAsk
	say?: BedrockCoderSay
	text?: string
	reasoning?: string
	images?: string[]
	files?: string[]
	partial?: boolean
	/**
	 * Freshness counter for convergent-replica merging on the webview side. Monotonically
	 * increasing per process; a higher `seq` means a newer copy of the SAME `ts` (identity).
	 * Stamped by the extension as the message flows to the webview. Optional for classic/legacy.
	 */
	seq?: number
	/**
	 * Conversation/replica fence. Messages from an older epoch (a previous task or a previous
	 * render of the same task) are dropped by the webview. Stamped by the extension. Optional
	 * for classic/legacy.
	 */
	epoch?: number
	commandCompleted?: boolean
	lastCheckpointHash?: string
	isCheckpointCheckedOut?: boolean
	isOperationOutsideWorkspace?: boolean
	conversationHistoryIndex?: number
	conversationHistoryDeletedRange?: [number, number] // for when conversation history is truncated for API requests
	modelInfo?: BedrockCoderMessageModelInfo
	/** Reference to extension-host retained output. Full content is fetched only on demand. */
	toolResultId?: string
	toolResultPreview?: string
	toolResultTruncated?: boolean
	toolResultIsError?: boolean
}

export type BedrockCoderAsk =
	| "followup"
	| "plan_mode_respond"
	| "act_mode_respond"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"
	| "browser_action_launch"
	| "use_mcp_server"
	| "new_task"
	| "condense"
	| "summarize_task"
	| "report_bug"
	| "use_subagents"

export type BedrockCoderSay =
	| "task"
	| "error"
	| "error_retry"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "reasoning"
	| "completion_result"
	| "user_feedback"
	| "user_feedback_diff"
	| "api_req_retried"
	| "command"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "shell_integration_warning_with_suggestion"
	| "browser_action_launch"
	| "browser_action"
	| "browser_action_result"
	| "mcp_server_request_started"
	| "mcp_server_response"
	| "mcp_notification"
	| "use_mcp_server"
	| "diff_error"
	| "deleted_api_reqs"
	| "bedrockCoderignore_error"
	| "command_permission_denied"
	| "checkpoint_created"
	| "load_mcp_documentation"
	| "info" // Added for general informational messages like retry status
	| "task_progress"
	| "hook_status"
	| "hook_output_stream"
	| "subagent"
	| "use_subagents"
	| "subagent_usage"
	| "conditional_rules_applied"
	| "compaction" // context compaction progress/result divider

export interface BedrockCoderSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "fileDeleted"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "listCodeDefinitionNames"
		| "searchFiles"
		| "webFetch"
		| "webSearch"
		| "summarizeTask"
		| "useSkill"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
	operationIsLocatedInWorkspace?: boolean
	/** Starting line numbers in the original file where each SEARCH block matched */
	startLineNumbers?: number[]
	/** One-based inclusive line range requested by read_file; readLineEnd omitted = open-ended read (for UI summaries). */
	readLineStart?: number
	readLineEnd?: number
}

// must keep in sync with system prompt
const browserActions = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const
export type BrowserAction = (typeof browserActions)[number]

export interface BedrockCoderSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	text?: string
}

export type SubagentExecutionStatus = "pending" | "running" | "completed" | "failed"

export interface SubagentStatusItem {
	index: number
	prompt: string
	status: SubagentExecutionStatus
	toolCalls: number
	inputTokens: number
	outputTokens: number
	totalCost: number
	contextTokens: number
	contextWindow: number
	contextUsagePercentage: number
	latestToolCall?: string
	result?: string
	error?: string
}

export interface BedrockCoderSaySubagentStatus {
	status: "running" | "completed" | "failed"
	total: number
	completed: number
	successes: number
	failures: number
	toolCalls: number
	inputTokens: number
	outputTokens: number
	contextWindow: number
	maxContextTokens: number
	maxContextUsagePercentage: number
	items: SubagentStatusItem[]
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
}

export interface BedrockCoderAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
}

export interface BedrockCoderAskUseSubagents {
	prompts: string[]
}

export interface BedrockCoderPlanModeResponse {
	response: string
	options?: string[]
	selected?: string
}

export interface BedrockCoderAskQuestion {
	question: string
	options?: string[]
	selected?: string
}

export interface BedrockCoderApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelReason?: BedrockCoderApiReqCancelReason
	streamingFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec: number
		errorSnippet?: string
	}
}

/**
 * JSON payload of a say:"compaction" message. Mirrors the CLI's compaction
 * divider (apps/cli/src/tui/utils/compaction-status.ts): a "started" row shows
 * a spinner and is later updated in place (same ts) to its terminal status.
 */
export interface BedrockCoderCompactionInfo {
	status: "started" | "completed" | "skipped" | "failed" | "cancelled"
	mode: "auto" | "manual"
	tokensBefore?: number
	tokensAfter?: number
	messagesBefore?: number
	messagesAfter?: number
}

export interface BedrockCoderSubagentUsageInfo {
	source: "subagents"
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost: number
}

type BedrockCoderApiReqCancelReason = "streaming_failed" | "user_cancelled" | "retries_exhausted"

export const COMPLETION_RESULT_CHANGES_FLAG = "HAS_CHANGES"
