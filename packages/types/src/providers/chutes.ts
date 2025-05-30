import type { ModelInfo } from "../model.js"

// https://llm.chutes.ai/v1 (OpenAI compatible)
export type ChutesModelId =
	| "deepseek-ai/DeepSeek-R1-0528"
	| "deepseek-ai/DeepSeek-R1"
	| "deepseek-ai/DeepSeek-V3"
	| "unsloth/Llama-3.3-70B-Instruct"
	| "chutesai/Llama-4-Scout-17B-16E-Instruct"
	| "unsloth/Mistral-Nemo-Instruct-2407"
	| "unsloth/gemma-3-12b-it"
	| "NousResearch/DeepHermes-3-Llama-3-8B-Preview"
	| "unsloth/gemma-3-4b-it"
	| "nvidia/Llama-3_3-Nemotron-Super-49B-v1"
	| "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1"
	| "chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8"
	| "deepseek-ai/DeepSeek-V3-Base"
	| "deepseek-ai/DeepSeek-R1-Zero"
	| "deepseek-ai/DeepSeek-V3-0324"
	| "Qwen/Qwen3-235B-A22B"
	| "Qwen/Qwen3-32B"
	| "Qwen/Qwen3-30B-A3B"
	| "Qwen/Qwen3-14B"
	| "Qwen/Qwen3-8B"
	| "microsoft/MAI-DS-R1-FP8"
	| "tngtech/DeepSeek-R1T-Chimera"

export const chutesDefaultModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1-0528"

export const chutesModels = {
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 0528 model.",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 model.",
	},
	"deepseek-ai/DeepSeek-V3": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 model.",
	},
	"unsloth/Llama-3.3-70B-Instruct": {
		maxTokens: 32768, // From Groq
		contextWindow: 131072, // From Groq
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.3 70B Instruct model.",
	},
	"chutesai/Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 32768,
		contextWindow: 512000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Scout 17B Instruct model, 512K context.",
	},
	"unsloth/Mistral-Nemo-Instruct-2407": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Mistral Nemo Instruct model.",
	},
	"unsloth/gemma-3-12b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 12B IT model.",
	},
	"NousResearch/DeepHermes-3-Llama-3-8B-Preview": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nous DeepHermes 3 Llama 3 8B Preview model.",
	},
	"unsloth/gemma-3-4b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 4B IT model.",
	},
	"nvidia/Llama-3_3-Nemotron-Super-49B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.3 Nemotron Super 49B model.",
	},
	"nvidia/Llama-3_1-Nemotron-Ultra-253B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.1 Nemotron Ultra 253B model.",
	},
	"chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Maverick 17B Instruct FP8 model.",
	},
	"deepseek-ai/DeepSeek-V3-Base": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 Base model.",
	},
	"deepseek-ai/DeepSeek-R1-Zero": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 Zero model.",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 (0324) model.",
	},
	"Qwen/Qwen3-235B-A22B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 235B A22B model.",
	},
	"Qwen/Qwen3-32B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 32B model.",
	},
	"Qwen/Qwen3-30B-A3B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 30B A3B model.",
	},
	"Qwen/Qwen3-14B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 14B model.",
	},
	"Qwen/Qwen3-8B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 8B model.",
	},
	"microsoft/MAI-DS-R1-FP8": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Microsoft MAI-DS-R1 FP8 model.",
	},
	"tngtech/DeepSeek-R1T-Chimera": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "TNGTech DeepSeek R1T Chimera model.",
	},
} as const satisfies Record<string, ModelInfo>
