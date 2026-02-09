import { Mode } from "../storage/types"

export interface BeadsmithMessageModelInfo {
	modelId: string
	providerId: string
	mode: Mode
}

interface BeadsmithTokensInfo {
	prompt: number // Total input tokens (includes cached + non-cached)
	completion: number // Total output tokens
	cached: number // Subset of prompt_tokens that were cache hits
}

export interface BeadsmithMessageMetricsInfo {
	tokens?: BeadsmithTokensInfo
	cost?: number // Monetary cost for this turn
}
