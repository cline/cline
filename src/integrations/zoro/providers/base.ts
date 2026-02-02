/**
 * Provider Adapter Pattern for Zoro Integration
 *
 * This module defines the base interface for provider adapters that handle
 * provider-specific message formatting, stream consumption, and error handling.
 *
 * The goal is to isolate provider quirks (especially Bedrock's) from the core
 * execution and verification engines, making the codebase more maintainable
 * and allowing easy addition of new providers.
 */

export interface ProviderAdapter {
	/** Provider name for logging and debugging */
	readonly name: string

	/**
	 * Prepares messages for the provider's API format
	 * Handles provider-specific filtering and formatting
	 */
	prepareMessages(messages: ConversationMessage[]): any[]

	/**
	 * Consumes a stream from the provider and routes chunks to callbacks
	 * Handles provider-specific chunk formats and aggregation
	 */
	consumeStream(stream: AsyncGenerator, callbacks: StreamCallbacks): Promise<ConsumedStreamResult>

	/**
	 * Builds an assistant message with provider-specific formatting
	 * Handles thinking blocks, text, and tool calls appropriately
	 */
	buildAssistantMessage(text: string, toolCalls: ToolCall[], thinking?: string, thinkingSignature?: string): any

	/**
	 * Builds a tool result message with provider-specific formatting
	 * Handles single vs multiple message requirements
	 */
	buildToolResultMessage(toolExecutions: ToolExecution[]): any

	/**
	 * Determines if an error can be recovered from
	 * Used to decide whether to retry or fail fast
	 */
	isRecoverableError(error: any): boolean

	/**
	 * Determines if an error should trigger a retry
	 * Used for transient errors like rate limits
	 */
	shouldRetry(error: any): boolean
}

/**
 * Standard conversation message format used internally by Zoro
 * Adapters convert to/from provider-specific formats
 */
export interface ConversationMessage {
	role: "user" | "assistant"
	content: MessageContent[]
}

/**
 * Content block types supported across providers
 */
export type MessageContent =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string; signature?: string }
	| { type: "tool_use"; id: string; name: string; input: any }
	| { type: "tool_result"; tool_use_id: string; content: string }

/**
 * Callbacks for stream consumption
 * Adapters invoke these as they process chunks
 */
export interface StreamCallbacks {
	onText: (text: string) => void
	onToolCall: (id: string, name: string, args: string) => void
	onThinking: (text: string, signature?: string) => void
	onComplete: () => void
}

/**
 * Result of stream consumption
 */
export interface ConsumedStreamResult {
	text: string
	toolCalls: ToolCall[]
	thinking: string
	thinkingSignature?: string
}

/**
 * Tool call in progress during streaming
 */
export interface ToolCall {
	id: string
	name: string
	arguments: string
}

/**
 * Completed tool execution result
 */
export interface ToolExecution {
	id: string
	name: string
	input: any
	result: string
}
