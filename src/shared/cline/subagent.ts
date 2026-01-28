import { ApiHandler } from "@/core/api"
import { ClineStorageMessage } from "@/shared/messages"

export interface AgentContext {
	filePaths: Set<string>
	searchResults: Map<string, GeneralToolResult>
	fileContents: Map<string, string>
	/** The agent's final result/answer text */
	resultText?: string
}

export interface SearchResult {
	query: string
	workspaceName?: string
	workspaceResults: string
	resultCount: number
	success: boolean
}
export interface GeneralToolResult {
	agent: string
	query: string
	result: string
	error?: string
	success: boolean
}

/**
 * Represents actions extracted from an agent's response
 */
export interface AgentActions {
	/** Tool calls to execute (e.g., search queries, file reads) */
	toolCalls: unknown[]
	/** @deprecated Use resultContent instead */
	contextFiles: string[]
	/** The agent's result/answer content extracted from the contextTag */
	resultContent: string[]
	/** Whether the agent is ready to provide a final answer */
	isReadyToAnswer: boolean
}

/**
 * Progress update sent during agent iteration
 */
export interface AgentIterationUpdate {
	/** Current iteration number (0-indexed) */
	iteration: number
	/** Maximum iterations allowed */
	maxIterations: number
	/** Actions extracted from the agent's response */
	actions?: AgentActions
	/** Current context state */
	context?: unknown
	/** Cost incurred in this iteration */
	cost?: number
	/** Message describing the current status etc */
	message?: string
}

/**
 * Configuration for creating a ClineAgent instance
 */
export interface ClineAgentConfig {
	/** Model ID to use (e.g., "x-ai/grok-code-fast-1") */
	modelId: string
	/** Maximum number of iterations in the agentic loop */
	maxIterations?: number
	/** Prompt for the agent */
	prompt: string
	/** System Prompt for the agent */
	systemPrompt?: string
	/** Starting messages for the agent */
	messages?: ClineStorageMessage[]
	/** API Request Params */
	apiParams?: Record<string, unknown>
	/** Optional API client to use instead of the default ClineHandler */
	client?: ApiHandler
	/** Optional tag name for context files extraction (default: no context extraction) */
	contextTag?: string
	/** Optional tag name for ready-to-answer check (default: no ready check) */
	answerTag?: string
	/** Optional AbortSignal to allow cancellation of the agent's execution */
	abortSignal?: AbortSignal
	/** The timestamp associated with the original tool call message */
	call_id: number
}
