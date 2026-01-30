/**
 * Minimal interface for API handler used by subagents.
 * This is a subset of the full ApiHandler interface from @/core/api,
 * defined here to avoid importing extension-only code into shared modules.
 */
export interface SubagentApiHandler {
	createMessage(systemPrompt: string, messages: SubagentMessage[], tools?: unknown[], useResponseApi?: boolean): unknown
	getModel(): { id: string; info: unknown }
	abort?(): void
}

/**
 * Minimal message interface for subagent communication.
 * Compatible with ClineStorageMessage from @/shared/messages.
 */
export interface SubagentMessage {
	role: "user" | "assistant"
	content: string | unknown[]
	id?: string
}

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
	/** The agent's result/answer content extracted from the contextTag */
	resultContent: string[]
	/** Whether the agent is ready to provide a final answer */
	isReadyToAnswer: boolean
}

/**
 * Progress update sent during agent iteration
 */
export interface AgentIterationUpdate {
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
 * A single status entry for subagent timeline display
 */
export interface SubagentStatusEntry {
	/** Iteration number (1-indexed) */
	iteration: number
	/** Maximum iterations */
	maxIterations: number
	/** Timestamp when this entry was created */
	timestamp: number
	/** Status message */
	status: string
	/** Type of status entry */
	type: "searching" | "reading" | "running" | "fetching" | "ready" | "message" | "cost" | "error"
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
	messages?: SubagentMessage[]
	/** API Request Params */
	apiParams?: Record<string, unknown>
	/** Optional API client to use instead of the default ClineHandler */
	client?: SubagentApiHandler
	/** Optional tag name for context files extraction (default: no context extraction) */
	contextTag?: string
	/** Optional tag name for ready-to-answer check (default: no ready check) */
	answerTag?: string
	/** Optional AbortSignal to allow cancellation of the agent's execution */
	abortSignal?: AbortSignal
	/** The tool call id associated with the original message */
	callId: string
}
