import type { ModelInfo } from "../model.js"

// https://inference-docs.cerebras.ai/api-reference/chat-completions
export type CerebrasModelId = keyof typeof cerebrasModels

export const cerebrasDefaultModelId: CerebrasModelId = "qwen-3-coder-480b-free"

export const cerebrasModels = {
	"qwen-3-coder-480b-free": {
		maxTokens: 40000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"SOTA coding model with ~2000 tokens/s ($0 free tier)\n\n• Use this if you don't have a Cerebras subscription\n• 64K context window\n• Rate limits: 150K TPM, 1M TPH/TPD, 10 RPM, 100 RPH/RPD\n\nUpgrade for higher limits: [https://cloud.cerebras.ai/?utm=roocode](https://cloud.cerebras.ai/?utm=roocode)",
	},
	"qwen-3-coder-480b": {
		maxTokens: 40000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"SOTA coding model with ~2000 tokens/s ($50/$250 paid tiers)\n\n• Use this if you have a Cerebras subscription\n• 131K context window with higher rate limits",
	},
	"qwen-3-235b-a22b-instruct-2507": {
		maxTokens: 64000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Intelligent model with ~1400 tokens/s",
	},
	"llama-3.3-70b": {
		maxTokens: 64000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Powerful model with ~2600 tokens/s",
	},
	"qwen-3-32b": {
		maxTokens: 64000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "SOTA coding performance with ~2500 tokens/s",
	},
	"qwen-3-235b-a22b-thinking-2507": {
		maxTokens: 40000,
		contextWindow: 65000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "SOTA performance with ~1500 tokens/s",
		supportsReasoningEffort: true,
	},
	"gpt-oss-120b": {
		maxTokens: 8000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"OpenAI GPT OSS model with ~2800 tokens/s\n\n• 64K context window\n• Excels at efficient reasoning across science, math, and coding",
	},
} as const satisfies Record<string, ModelInfo>
