import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "anthropic"

const ANTHROPIC_MODELS: Record<string, ModelInfo> = {
	"claude-sonnet-4-5-20250929": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 3.0,
			output: 15.0,
			cacheWrite: 3.75,
			cacheRead: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-sonnet-4-5-20250929:1m": {
		contextWindow: 1_000_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 3.0,
			output: 15.0,
			cacheWrite: 3.75,
			cacheRead: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-haiku-4-5-20251001": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 1.0,
			output: 5.0,
			cacheWrite: 1.25,
			cacheRead: 0.1,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-sonnet-4-20250514": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 3.0,
			output: 15.0,
			cacheWrite: 3.75,
			cacheRead: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-sonnet-4-20250514:1m": {
		contextWindow: 1_000_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 3.0,
			output: 15.0,
			cacheWrite: 3.75,
			cacheRead: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-opus-4-5-20251101": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 5.0,
			output: 25.0,
			cacheWrite: 6.25,
			cacheRead: 0.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-opus-4-1-20250805": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 15.0,
			output: 75.0,
			cacheWrite: 18.75,
			cacheRead: 1.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-opus-4-20250514": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 15.0,
			output: 75.0,
			cacheWrite: 18.75,
			cacheRead: 1.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-3-7-sonnet-20250219": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 3.0,
			output: 15.0,
			cacheWrite: 3.75,
			cacheRead: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: { enabled: true },
	},
	"claude-3-5-sonnet-20241022": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 3.0,
			output: 15.0,
			cacheWrite: 3.75,
			cacheRead: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
	},
	"claude-3-5-haiku-20241022": {
		contextWindow: 200_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 0.8,
			output: 4.0,
			cacheWrite: 1.0,
			cacheRead: 0.08,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
	},
	"claude-3-opus-20240229": {
		contextWindow: 200_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 15.0,
			output: 75.0,
			cacheWrite: 18.75,
			cacheRead: 1.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
	},
	"claude-3-haiku-20240307": {
		contextWindow: 200_000,
		maxOutputTokens: 4096,
		pricing: {
			input: 0.25,
			output: 1.25,
			cacheWrite: 0.3,
			cacheRead: 0.03,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
	},
}

// Register Anthropic models with the registry
modelRegistry.registerProvider(PROVIDER_NAME, ANTHROPIC_MODELS)
