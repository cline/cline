import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "qwen-code"

const MODELS: Record<string, ModelInfo> = {
	"qwen3-coder-plus": {
		maxOutputTokens: 65_536,
		contextWindow: 1_000_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Qwen3 Coder Plus - High-performance coding model with 1M context window for large codebases",
	},
	"qwen3-coder-flash": {
		maxOutputTokens: 65_536,
		contextWindow: 1_000_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Qwen3 Coder Flash - Fast coding model with 1M context window optimized for speed",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
