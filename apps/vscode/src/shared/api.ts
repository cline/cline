import type { ApiHandlerSettings } from "./storage/state-keys"

/** AWS Bedrock is the extension's only inference provider. */
export type ApiProvider = "bedrock"
export const DEFAULT_API_PROVIDER: ApiProvider = "bedrock"

export interface ApiHandlerOptions extends Partial<ApiHandlerSettings> {
	ulid?: string
	onRetryAttempt?: (attempt: number, maxRetries: number, delay: number, error: unknown) => void
}

export type ApiConfiguration = ApiHandlerOptions

interface PriceTier {
	tokenLimit: number
	price: number
}

export interface ModelInfo {
	name?: string
	maxTokens?: number
	contextWindow?: number
	supportsImages?: boolean
	supportsPromptCache: boolean
	supportsReasoning?: boolean
	inputPrice?: number
	outputPrice?: number
	thinkingConfig?: {
		maxBudget?: number
		outputPrice?: number
		outputPriceTiers?: PriceTier[]
		supportsThinkingLevel?: boolean
	}
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	description?: string
	tiers?: {
		contextWindow: number
		inputPrice?: number
		outputPrice?: number
		cacheWritesPrice?: number
		cacheReadsPrice?: number
	}[]
	temperature?: number
}

export type BedrockModelId = string
export const BEDROCK_DEFAULT_REGION = "us-east-1"
export const BEDROCK_DEFAULT_MODEL_ID = "anthropic.claude-sonnet-4-6"
export const ANTHROPIC_MIN_THINKING_BUDGET = 1_024
export const ANTHROPIC_MAX_THINKING_BUDGET = 6_000

export function getModelSlug(modelId: string): string {
	return modelId.split("/").at(-1) ?? modelId
}

export function buildModelInfoNameMap(models: Record<string, ModelInfo>): Record<string, ModelInfo> {
	return Object.fromEntries(Object.entries(models).map(([id, info]) => [getModelSlug(id), info]))
}
