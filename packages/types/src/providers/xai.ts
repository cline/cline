import type { ModelInfo } from "../model.js"

// https://docs.x.ai/docs/api-reference
export type XAIModelId = keyof typeof xaiModels

export const xaiDefaultModelId: XAIModelId = "grok-4"

export const xaiModels = {
	"grok-4": {
		maxTokens: 8192,
		contextWindow: 256000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 0.75,
		cacheReadsPrice: 0.75,
		description: "xAI's Grok-4 model with 256K context window",
	},
	"grok-3": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 0.75,
		cacheReadsPrice: 0.75,
		description: "xAI's Grok-3 model with 128K context window",
	},
	"grok-3-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 1.25,
		description: "xAI's Grok-3 fast model with 128K context window",
	},
	"grok-3-mini": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.3,
		outputPrice: 0.5,
		cacheWritesPrice: 0.07,
		cacheReadsPrice: 0.07,
		description: "xAI's Grok-3 mini model with 128K context window",
		supportsReasoningEffort: true,
	},
	"grok-3-mini-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 4.0,
		cacheWritesPrice: 0.15,
		cacheReadsPrice: 0.15,
		description: "xAI's Grok-3 mini fast model with 128K context window",
		supportsReasoningEffort: true,
	},
	"grok-2-1212": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 model (version 1212) with 128K context window",
	},
	"grok-2-vision-1212": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 Vision model (version 1212) with image support and 32K context window",
	},
} as const satisfies Record<string, ModelInfo>
