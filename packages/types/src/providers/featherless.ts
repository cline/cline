import type { ModelInfo } from "../model.js"

export type FeatherlessModelId =
	| "deepseek-ai/DeepSeek-V3-0324"
	| "deepseek-ai/DeepSeek-R1-0528"
	| "moonshotai/Kimi-K2-Instruct"
	| "openai/gpt-oss-120b"
	| "Qwen/Qwen3-Coder-480B-A35B-Instruct"

export const featherlessModels = {
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 4096,
		contextWindow: 32678,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 0324 model.",
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 4096,
		contextWindow: 32678,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 0528 model.",
	},
	"moonshotai/Kimi-K2-Instruct": {
		maxTokens: 4096,
		contextWindow: 32678,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Kimi K2 Instruct model.",
	},
	"openai/gpt-oss-120b": {
		maxTokens: 4096,
		contextWindow: 32678,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-OSS 120B model.",
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		maxTokens: 4096,
		contextWindow: 32678,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 Coder 480B A35B Instruct model.",
	},
} as const satisfies Record<string, ModelInfo>

export const featherlessDefaultModelId: FeatherlessModelId = "deepseek-ai/DeepSeek-R1-0528"
