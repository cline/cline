export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk = ApiStreamTextChunk | ApiStreamReasoningChunk | ApiStreamUsageChunk | ApiStreamToolCallChunk

export interface ApiStreamTextChunk {
	type: "text"
	text: string
}

export interface ApiStreamReasoningChunk {
	type: "reasoning"
	reasoning: string
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

export interface ApiStreamToolCallChunk {
	type: "tool_call"
	callId: string
	name: string
	arguments: Record<string, unknown>
	rawArguments: string
}
