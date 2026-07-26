import { Mode } from "../storage/types"

export interface BedrockCoderMessageModelInfo {
	modelId: string
	providerId: string
	mode: Mode
}

interface BedrockCoderTokensInfo {
	prompt: number // Total input tokens (includes cached + non-cached)
	completion: number // Total output tokens
	cached: number // Subset of prompt_tokens that were cache hits
}

export interface BedrockCoderMessageMetricsInfo {
	tokens?: BedrockCoderTokensInfo
	cost?: number // Monetary cost for this turn
}
