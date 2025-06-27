import type { ModelInfo } from "../model.js"

// https://console.groq.com/docs/models
export type GroqModelId =
	| "llama-3.1-8b-instant"
	| "llama-3.3-70b-versatile"
	| "meta-llama/llama-4-scout-17b-16e-instruct"
	| "meta-llama/llama-4-maverick-17b-128e-instruct"
	| "mistral-saba-24b"
	| "qwen-qwq-32b"
	| "qwen/qwen3-32b"
	| "deepseek-r1-distill-llama-70b"

export const groqDefaultModelId: GroqModelId = "llama-3.3-70b-versatile" // Defaulting to Llama3 70B Versatile

export const groqModels = {
	// Models based on API response: https://api.groq.com/openai/v1/models
	"llama-3.1-8b-instant": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.05,
		outputPrice: 0.08,
		description: "Meta Llama 3.1 8B Instant model, 128K context.",
	},
	"llama-3.3-70b-versatile": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.59,
		outputPrice: 0.79,
		description: "Meta Llama 3.3 70B Versatile model, 128K context.",
	},
	"meta-llama/llama-4-scout-17b-16e-instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.11,
		outputPrice: 0.34,
		description: "Meta Llama 4 Scout 17B Instruct model, 128K context.",
	},
	"meta-llama/llama-4-maverick-17b-128e-instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
		description: "Meta Llama 4 Maverick 17B Instruct model, 128K context.",
	},
	"mistral-saba-24b": {
		maxTokens: 32768,
		contextWindow: 32768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.79,
		outputPrice: 0.79,
		description: "Mistral Saba 24B model, 32K context.",
	},
	"qwen-qwq-32b": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.29,
		outputPrice: 0.39,
		description: "Alibaba Qwen QwQ 32B model, 128K context.",
	},
	"qwen/qwen3-32b": {
		maxTokens: 40960,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.29,
		outputPrice: 0.59,
		description: "Alibaba Qwen 3 32B model, 128K context.",
	},
	"deepseek-r1-distill-llama-70b": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.75,
		outputPrice: 0.99,
		description: "DeepSeek R1 Distill Llama 70B model, 128K context.",
	},
} as const satisfies Record<string, ModelInfo>
