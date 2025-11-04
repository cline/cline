export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk = ApiStreamTextChunk | ApiStreamThinkingChunk | ApiStreamUsageChunk | ApiStreamToolCallsChunk

export interface ApiStreamTextChunk {
	type: "text"
	text: string
}

export interface ApiStreamUsageChunk {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	thoughtsTokenCount?: number // openrouter
	totalCost?: number // openrouter
}

export interface ApiStreamToolCallsChunk {
	type: "tool_calls"
	tool_call: ApiStreamToolCall
}

export interface ApiStreamToolCall {
	call_id?: string // The call / request ID associated with this tool call
	// Information about the tool being called
	function: {
		id?: string // The tool call ID
		name?: string
		arguments?: any
	}
}

export interface ApiStreamThinkingChunk {
	type: "reasoning"
	reasoning: string
	details?: any // openrouter has various properties that we can pass back unmodified in api requests to preserve reasoning traces
	signature?: string
	redacted_data?: string
}
