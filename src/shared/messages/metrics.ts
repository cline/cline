export interface ClineMessageModelInfo {
	modelId: string
	providerId: string
	temperature?: number
	maxTokens?: number
	reasoningEffort?: string | number
}

export interface ClineTokenMetrics {
	promptTokens: number // Total input tokens (includes cached + non-cached)
	completionTokens: number // Total output tokens
	cachedTokens: number // Subset of prompt_tokens that were cache hits
	totalCost: number // Monetary cost for this step
}
