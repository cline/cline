import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "minimax"

const MODELS: Record<string, ModelInfo> = {
	"MiniMax-M2.1": {
		maxOutputTokens: 128_000,
		contextWindow: 192_000,
		pricing: {
			input: 0.3,
			output: 1.2,
			cacheWrite: 0.0375,
			cacheRead: 0.03,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
	},
	"MiniMax-M2.1-lightning": {
		maxOutputTokens: 128_000,
		contextWindow: 192_000,
		pricing: {
			input: 0.3,
			output: 2.4,
			cacheWrite: 0.0375,
			cacheRead: 0.03,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
	},
	"MiniMax-M2": {
		maxOutputTokens: 128_000,
		contextWindow: 192_000,
		pricing: {
			input: 0.3,
			output: 1.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
