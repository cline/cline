export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk =
	| ApiStreamTextChunk
	| ApiStreamReasoningChunk
	| ApiStreamReasoningDetailsChunk
	| ApiStreamAnthropicThinkingChunk
	| ApiStreamAnthropicRedactedThinkingChunk
	| ApiStreamUsageChunk
	| ApiStreamToolCallsChunk

export interface ApiStreamTextChunk {
	type: "text"
	text: string
}

export interface ApiStreamReasoningChunk {
	type: "reasoning"
	reasoning: string
}

export interface ApiStreamReasoningDetailsChunk {
	type: "reasoning_details"
	reasoning_details: any // openrouter has various properties that we can pass back unmodified in api requests to preserve reasoning traces
}

export interface ApiStreamAnthropicThinkingChunk {
	type: "ant_thinking"
	thinking: string
	signature: string
}

export interface ApiStreamAnthropicRedactedThinkingChunk {
	type: "ant_redacted_thinking"
	data: string
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
	tool_call: any
}

export interface ApiStreamToolCall {
	id: string
	type: "function"
	function: {
		name: string
		arguments: any
	}
}
