import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "doubao"

const MODELS: Record<string, ModelInfo> = {
	"doubao-1-5-pro-256k-250115": {
		maxOutputTokens: 12_288,
		contextWindow: 256_000,
		pricing: {
			input: 0.7,
			output: 1.3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"doubao-1-5-pro-32k-250115": {
		maxOutputTokens: 12_288,
		contextWindow: 32_000,
		pricing: {
			input: 0.11,
			output: 0.3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-v3-250324": {
		maxOutputTokens: 12_288,
		contextWindow: 128_000,
		pricing: {
			input: 0.55,
			output: 2.19,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-r1-250120": {
		maxOutputTokens: 32_768,
		contextWindow: 64_000,
		pricing: {
			input: 0.27,
			output: 1.09,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
