import { Mode } from "../storage/types"

export interface ClineMessageModelInfo {
	modelId: string
	providerId: string
	mode: Mode
}

interface ClineTokensInfo {
	prompt: number // Total input tokens (includes cached + non-cached)
	completion: number // Total output tokens
	cached: number // Subset of prompt_tokens that were cache hits
}

export interface ClineMessageMetricsInfo {
	tokens?: ClineTokensInfo
	cost?: number // Monetary cost for this turn
}
