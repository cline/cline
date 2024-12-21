export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk = ApiStreamTextChunk | ApiStreamUsageChunk | ApiStreamToolCallChunk

export interface ApiStreamToolCallChunk {
	type: "tool_call"
	name: string
	args: Record<string, any>
}

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
	totalCost?: number // openrouter
}
