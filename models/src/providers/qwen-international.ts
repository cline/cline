import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "qwen-international"

const MODELS: Record<string, ModelInfo> = {
	"qwen3-coder-plus": {
		maxOutputTokens: 65_536,
		contextWindow: 1_000_000,
		pricing: {
			input: 1,
			output: 5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen3-coder-480b-a35b-instruct": {
		maxOutputTokens: 65_536,
		contextWindow: 204_800,
		pricing: {
			input: 1.5,
			output: 7.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen3-235b-a22b": {
		maxOutputTokens: 16_384,
		contextWindow: 131_072,
		pricing: {
			input: 2,
			output: 8,
			cacheWrite: 2,
			cacheRead: 8,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 20,
		},
	},
	"qwen3-32b": {
		maxOutputTokens: 16_384,
		contextWindow: 131_072,
		pricing: {
			input: 2,
			output: 8,
			cacheWrite: 2,
			cacheRead: 8,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 20,
		},
	},
	"qwen3-30b-a3b": {
		maxOutputTokens: 16_384,
		contextWindow: 131_072,
		pricing: {
			input: 0.75,
			output: 3,
			cacheWrite: 0.75,
			cacheRead: 3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 7.5,
		},
	},
	"qwen3-14b": {
		maxOutputTokens: 8_192,
		contextWindow: 131_072,
		pricing: {
			input: 1,
			output: 4,
			cacheWrite: 1,
			cacheRead: 4,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 10,
		},
	},
	"qwen3-8b": {
		maxOutputTokens: 8_192,
		contextWindow: 131_072,
		pricing: {
			input: 0.5,
			output: 2,
			cacheWrite: 0.5,
			cacheRead: 2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 5,
		},
	},
	"qwen3-4b": {
		maxOutputTokens: 8_192,
		contextWindow: 131_072,
		pricing: {
			input: 0.3,
			output: 1.2,
			cacheWrite: 0.3,
			cacheRead: 1.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 3,
		},
	},
	"qwen3-1.7b": {
		maxOutputTokens: 8_192,
		contextWindow: 32_768,
		pricing: {
			input: 0.3,
			output: 1.2,
			cacheWrite: 0.3,
			cacheRead: 1.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 30_720,
			outputPrice: 3,
		},
	},
	"qwen3-0.6b": {
		maxOutputTokens: 8_192,
		contextWindow: 32_768,
		pricing: {
			input: 0.3,
			output: 1.2,
			cacheWrite: 0.3,
			cacheRead: 1.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 30_720,
			outputPrice: 3,
		},
	},
	"qwen2.5-coder-32b-instruct": {
		maxOutputTokens: 8_192,
		contextWindow: 131_072,
		pricing: {
			input: 0.002,
			output: 0.006,
			cacheWrite: 0.002,
			cacheRead: 0.006,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen2.5-coder-14b-instruct": {
		maxOutputTokens: 8_192,
		contextWindow: 131_072,
		pricing: {
			input: 0.002,
			output: 0.006,
			cacheWrite: 0.002,
			cacheRead: 0.006,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen2.5-coder-7b-instruct": {
		maxOutputTokens: 8_192,
		contextWindow: 131_072,
		pricing: {
			input: 0.001,
			output: 0.002,
			cacheWrite: 0.001,
			cacheRead: 0.002,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen2.5-coder-3b-instruct": {
		maxOutputTokens: 8_192,
		contextWindow: 32_768,
		pricing: {
			input: 0.0,
			output: 0.0,
			cacheWrite: 0.0,
			cacheRead: 0.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen2.5-coder-1.5b-instruct": {
		maxOutputTokens: 8_192,
		contextWindow: 32_768,
		pricing: {
			input: 0.0,
			output: 0.0,
			cacheWrite: 0.0,
			cacheRead: 0.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen2.5-coder-0.5b-instruct": {
		maxOutputTokens: 8_192,
		contextWindow: 32_768,
		pricing: {
			input: 0.0,
			output: 0.0,
			cacheWrite: 0.0,
			cacheRead: 0.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen-coder-plus-latest": {
		maxOutputTokens: 129_024,
		contextWindow: 131_072,
		pricing: {
			input: 3.5,
			output: 7,
			cacheWrite: 3.5,
			cacheRead: 7,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen-plus-latest": {
		maxOutputTokens: 16_384,
		contextWindow: 131_072,
		pricing: {
			input: 0.8,
			output: 2,
			cacheWrite: 0.8,
			cacheRead: 2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 16,
		},
	},
	"qwen-turbo-latest": {
		maxOutputTokens: 16_384,
		contextWindow: 1_000_000,
		pricing: {
			input: 0.3,
			output: 0.6,
			cacheWrite: 0.3,
			cacheRead: 0.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			maxBudgetTokens: 38_912,
			outputPrice: 6,
		},
	},
	"qwen-max-latest": {
		maxOutputTokens: 30_720,
		contextWindow: 32_768,
		pricing: {
			input: 2.4,
			output: 9.6,
			cacheWrite: 2.4,
			cacheRead: 9.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen-coder-plus": {
		maxOutputTokens: 129_024,
		contextWindow: 131_072,
		pricing: {
			input: 3.5,
			output: 7,
			cacheWrite: 3.5,
			cacheRead: 7,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen-plus": {
		maxOutputTokens: 129_024,
		contextWindow: 131_072,
		pricing: {
			input: 0.8,
			output: 2,
			cacheWrite: 0.8,
			cacheRead: 0.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen-turbo": {
		maxOutputTokens: 1_000_000,
		contextWindow: 1_000_000,
		pricing: {
			input: 0.3,
			output: 0.6,
			cacheWrite: 0.3,
			cacheRead: 0.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"qwen-max": {
		maxOutputTokens: 30_720,
		contextWindow: 32_768,
		pricing: {
			input: 2.4,
			output: 9.6,
			cacheWrite: 2.4,
			cacheRead: 9.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-v3": {
		maxOutputTokens: 8_000,
		contextWindow: 64_000,
		pricing: {
			input: 0,
			output: 0.28,
			cacheWrite: 0.14,
			cacheRead: 0.014,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
	},
	"deepseek-r1": {
		maxOutputTokens: 8_000,
		contextWindow: 64_000,
		pricing: {
			input: 0,
			output: 2.19,
			cacheWrite: 0.55,
			cacheRead: 0.14,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
	},
	"qwen-vl-max": {
		maxOutputTokens: 30_720,
		contextWindow: 32_768,
		pricing: {
			input: 3,
			output: 9,
			cacheWrite: 3,
			cacheRead: 9,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"qwen-vl-max-latest": {
		maxOutputTokens: 129_024,
		contextWindow: 131_072,
		pricing: {
			input: 3,
			output: 9,
			cacheWrite: 3,
			cacheRead: 9,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"qwen-vl-plus": {
		maxOutputTokens: 6_000,
		contextWindow: 8_000,
		pricing: {
			input: 1.5,
			output: 4.5,
			cacheWrite: 1.5,
			cacheRead: 4.5,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"qwen-vl-plus-latest": {
		maxOutputTokens: 129_024,
		contextWindow: 131_072,
		pricing: {
			input: 1.5,
			output: 4.5,
			cacheWrite: 1.5,
			cacheRead: 4.5,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
