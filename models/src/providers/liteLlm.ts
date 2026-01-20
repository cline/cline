import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "liteLlm"

const MODELS: Record<string, ModelInfo> = {
	"anthropic/claude-3-7-sonnet-20250219": {
		contextWindow: 128_000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 0,
			output: 0,
			cacheWrite: 0,
			cacheRead: 0,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		temperature: 0,
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
