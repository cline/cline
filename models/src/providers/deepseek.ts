import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "deepseek"

const MODELS: Record<string, ModelInfo> = {
	"deepseek-chat": {
		maxOutputTokens: 8_000,
		contextWindow: 128_000,
		pricing: {
			input: 0, // technically there is no input price, it's all either a cache hit or miss (ApiOptions will not show this). Input is the sum of cache reads and writes
			output: 1.1,
			cacheWrite: 0.27,
			cacheRead: 0.07,
		},
		capabilities: {
			images: false,
			promptCache: true, // supports context caching, but not in the way anthropic does it (deepseek reports input tokens and reads/writes in the same usage report) FIXME: we need to show users cache stats how deepseek does it
		},
	},
	"deepseek-reasoner": {
		maxOutputTokens: 8_000,
		contextWindow: 128_000,
		pricing: {
			input: 0, // technically there is no input price, it's all either a cache hit or miss (ApiOptions will not show this)
			output: 2.19,
			cacheWrite: 0.55,
			cacheRead: 0.14,
		},
		capabilities: {
			images: false,
			promptCache: true, // supports context caching, but not in the way anthropic does it (deepseek reports input tokens and reads/writes in the same usage report) FIXME: we need to show users cache stats how deepseek does it
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
