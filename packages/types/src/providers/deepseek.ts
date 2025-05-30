import type { ModelInfo } from "../model.js"

// https://platform.deepseek.com/docs/api
export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"

export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8192,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.27, // $0.27 per million tokens (cache miss)
		outputPrice: 1.1, // $1.10 per million tokens
		cacheWritesPrice: 0.27, // $0.27 per million tokens (cache miss)
		cacheReadsPrice: 0.07, // $0.07 per million tokens (cache hit).
		description: `DeepSeek-V3 achieves a significant breakthrough in inference speed over previous models. It tops the leaderboard among open-source models and rivals the most advanced closed-source models globally.`,
	},
	"deepseek-reasoner": {
		maxTokens: 8192,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.55, // $0.55 per million tokens (cache miss)
		outputPrice: 2.19, // $2.19 per million tokens
		cacheWritesPrice: 0.55, // $0.55 per million tokens (cache miss)
		cacheReadsPrice: 0.14, // $0.14 per million tokens (cache hit)
		description: `DeepSeek-R1 achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks. Supports Chain of Thought reasoning with up to 32K tokens.`,
	},
} as const satisfies Record<string, ModelInfo>

export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.6
