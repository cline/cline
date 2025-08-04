import type { ModelInfo } from "../model.js"

export const doubaoDefaultModelId = "doubao-seed-1-6-250615"

export const doubaoModels = {
	"doubao-seed-1-6-250615": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.0001, // $0.0001 per million tokens (cache miss)
		outputPrice: 0.0004, // $0.0004 per million tokens
		cacheWritesPrice: 0.0001, // $0.0001 per million tokens (cache miss)
		cacheReadsPrice: 0.00002, // $0.00002 per million tokens (cache hit)
		description: `Doubao Seed 1.6 is a powerful model designed for high-performance tasks with extensive context handling.`,
	},
	"doubao-seed-1-6-thinking-250715": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.0002, // $0.0002 per million tokens
		outputPrice: 0.0008, // $0.0008 per million tokens
		cacheWritesPrice: 0.0002, // $0.0002 per million
		cacheReadsPrice: 0.00004, // $0.00004 per million tokens (cache hit)
		description: `Doubao Seed 1.6 Thinking is optimized for reasoning tasks, providing enhanced performance in complex problem-solving scenarios.`,
	},
	"doubao-seed-1-6-flash-250715": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.00015, // $0.00015 per million tokens
		outputPrice: 0.0006, // $0.0006 per million tokens
		cacheWritesPrice: 0.00015, // $0.00015 per million
		cacheReadsPrice: 0.00003, // $0.00003 per million tokens (cache hit)
		description: `Doubao Seed 1.6 Flash is tailored for speed and efficiency, making it ideal for applications requiring rapid responses.`,
	},
} as const satisfies Record<string, ModelInfo>

export const doubaoDefaultModelInfo: ModelInfo = doubaoModels[doubaoDefaultModelId]

export const DOUBAO_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
export const DOUBAO_API_CHAT_PATH = "/chat/completions"
