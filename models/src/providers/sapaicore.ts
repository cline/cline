import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "sapaicore"

const sapAiCoreModelDescription = "Pricing is calculated using SAP's Capacity Units rather than direct USD pricing."

const MODELS: Record<string, ModelInfo> = {
	"anthropic--claude-4.5-haiku": {
		maxOutputTokens: 64000,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-4.5-sonnet": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-4-sonnet": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-4.5-opus": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-4-opus": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3.7-sonnet": {
		maxOutputTokens: 64_000,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3.5-sonnet": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3-sonnet": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3-haiku": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3-opus": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"gemini-2.5-pro": {
		maxOutputTokens: 65536,
		contextWindow: 1_048_576,
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
		reasoning: {
			maxBudgetTokens: 32767,
		},
		description: sapAiCoreModelDescription,
	},
	"gemini-2.5-flash": {
		maxOutputTokens: 65536,
		contextWindow: 1_048_576,
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
		reasoning: {
			maxBudgetTokens: 24576,
		},
		description: sapAiCoreModelDescription,
	},
	"gpt-4": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"gpt-4o": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"gpt-4o-mini": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"gpt-4.1": {
		maxOutputTokens: 32_768,
		contextWindow: 1_047_576,
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
		description: sapAiCoreModelDescription,
	},
	"gpt-4.1-nano": {
		maxOutputTokens: 32_768,
		contextWindow: 1_047_576,
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
		description: sapAiCoreModelDescription,
	},
	"gpt-5": {
		maxOutputTokens: 128_000,
		contextWindow: 272_000,
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
		description: sapAiCoreModelDescription,
	},
	"gpt-5-nano": {
		maxOutputTokens: 128_000,
		contextWindow: 272_000,
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
		description: sapAiCoreModelDescription,
	},
	"gpt-5-mini": {
		maxOutputTokens: 128_000,
		contextWindow: 272_000,
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
		description: sapAiCoreModelDescription,
	},
	o1: {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	o3: {
		maxOutputTokens: 100_000,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	"o3-mini": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"o4-mini": {
		maxOutputTokens: 100_000,
		contextWindow: 200_000,
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
		description: sapAiCoreModelDescription,
	},
	sonar: {
		maxOutputTokens: 128_000,
		contextWindow: 128_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
	"sonar-pro": {
		maxOutputTokens: 128_000,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: sapAiCoreModelDescription,
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
