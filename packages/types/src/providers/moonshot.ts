import type { ModelInfo } from "../model.js"

// https://platform.moonshot.ai/
export type MoonshotModelId = keyof typeof moonshotModels

export const moonshotDefaultModelId: MoonshotModelId = "kimi-k2-0711-preview"

export const moonshotModels = {
	"kimi-k2-0711-preview": {
		maxTokens: 32_000,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6, // $0.60 per million tokens (cache miss)
		outputPrice: 2.5, // $2.50 per million tokens
		cacheWritesPrice: 0, // $0 per million tokens (cache miss)
		cacheReadsPrice: 0.15, // $0.15 per million tokens (cache hit)
		description: `Kimi K2 is a state-of-the-art mixture-of-experts (MoE) language model with 32 billion activated parameters and 1 trillion total parameters.`,
	},
} as const satisfies Record<string, ModelInfo>

export const MOONSHOT_DEFAULT_TEMPERATURE = 0.6
