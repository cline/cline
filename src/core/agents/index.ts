import { ClineStorageMessage } from "@/shared/messages"
import { ApiHandler } from "../api"

export interface SearchResult {
	workspaceName?: string
	workspaceResults: string
	resultCount: number
	success: boolean
}

export interface AgentContext {
	filePaths: Set<string>
	searchResults: Map<string, SearchResult>
	fileContents: Map<string, string>
}

export interface FileReadResult {
	filePath: string
	content: string
	success: boolean
}

/**
 * Represents actions extracted from an agent's response
 */
export interface AgentActions {
	/** Tool calls to execute (e.g., search queries, file reads) */
	toolCalls: unknown[]
	/** Context files the agent wants to use in the final answer */
	contextFiles: string[]
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
	/** Callback for iteration progress updates */
	onIterationUpdate: (update: AgentIterationUpdate) => void | Promise<void>
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
}
