/**
 * Quantrel API Type Definitions
 */

/**
 * Model/Agent information from /api/agents
 */
export interface QuantrelAgent {
	id: number // Use as agentId when creating chat
	modelId: string // e.g., "anthropic/claude-sonnet-4.5"
	name: string
	publisher: string
	briefDescription: string
	inputPrice: number // Per 1M tokens
	outputPrice: number // Per 1M tokens
	contextWindow: number
	inputTypes: string[]
	outputTypes: string[]
	tags: string[]
	reasoning: number // 0-10 score
	intelligence: number // 0-10 score
	speed: number // 0-10 score
}

/**
 * Chat session from /api/chats
 */
export interface QuantrelChat {
	id: number
	userId: number
	agentId: number
	title: string
	status: "active" | "archived"
	createdAt?: string
	updatedAt?: string
}

/**
 * Message from chat history
 */
export interface QuantrelMessage {
	id: number
	chatId: number
	content: string
	role: "user" | "assistant"
	createdAt: string
	inputTokens?: number
	outputTokens?: number
	cost?: number
}

/**
 * SSE Stream Events from /api/chats/{id}/messages/stream
 */

/**
 * Event: start
 */
export interface QuantrelStreamStartEvent {
	estimatedCost: number
	streamId: string
	status: "streaming_started"
	estimatedOutputTokens: number
	messageId: number
	estimatedInputTokens: number
}

/**
 * Event: chunk
 */
export interface QuantrelStreamChunkEvent {
	done: boolean
	delta: string
	inputTokens?: number
	outputTokens?: number
	generationId?: string
	reasoningTokens?: number
	finishReason?: string | null
}

/**
 * Event: complete
 */
export interface QuantrelStreamCompleteEvent {
	estimatedInputCost: number
	estimatedOutputCost: number
	billingPending: boolean
	finishReason: string | null
	messageId: number
	inputTokens: number
	estimatedCost: number
	outputTokens: number
	durationMs: number
}

/**
 * Union type for all SSE events
 */
export type QuantrelStreamEvent =
	| { event: "start"; data: QuantrelStreamStartEvent }
	| { event: "chunk"; data: QuantrelStreamChunkEvent }
	| { event: "complete"; data: QuantrelStreamCompleteEvent }

/**
 * Error response from API
 */
export interface QuantrelErrorResponse {
	error?: string
	message?: string
	status?: number
}
