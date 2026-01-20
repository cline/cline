import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "sambanova"

const MODELS: Record<string, ModelInfo> = {
	"Llama-4-Maverick-17B-128E-Instruct": {
		contextWindow: 8_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.63,
			output: 1.8,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"Llama-4-Scout-17B-16E-Instruct": {
		contextWindow: 8_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.4,
			output: 0.7,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Meta-Llama-3.3-70B-Instruct": {
		contextWindow: 128_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.6,
			output: 1.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"DeepSeek-R1-Distill-Llama-70B": {
		contextWindow: 128_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.7,
			output: 1.4,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"DeepSeek-R1": {
		contextWindow: 16_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 5.0,
			output: 7.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Meta-Llama-3.1-405B-Instruct": {
		contextWindow: 16_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 5.0,
			output: 10.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Meta-Llama-3.1-8B-Instruct": {
		contextWindow: 16_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.1,
			output: 0.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Meta-Llama-3.2-1B-Instruct": {
		contextWindow: 16_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.04,
			output: 0.08,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Meta-Llama-3.2-3B-Instruct": {
		contextWindow: 8_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.08,
			output: 0.16,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen3-32B": {
		contextWindow: 16_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.4,
			output: 0.8,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"QwQ-32B": {
		contextWindow: 16_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.5,
			output: 1.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"DeepSeek-V3-0324": {
		contextWindow: 8_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 3.0,
			output: 4.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"DeepSeek-V3.1": {
		contextWindow: 32_000,
		maxOutputTokens: 7168,
		pricing: {
			input: 3.0,
			output: 4.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
