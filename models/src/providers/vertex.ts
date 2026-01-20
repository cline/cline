import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "vertex"

const MODELS: Record<string, ModelInfo> = {
	"gemini-3-pro-preview": {
		maxOutputTokens: 8192,
		contextWindow: 1_048_576,
		pricing: {
			input: 2.0,
			output: 12.0,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		supportsGlobalEndpoint: true,
		temperature: 1.0,
		reasoning: {
			enabled: true,
			thinkingLevel: "high",
			supportsThinkingLevel: true,
		},
	},
	"gemini-3-flash-preview": {
		maxOutputTokens: 65536,
		contextWindow: 1_048_576,
		pricing: {
			input: 0.5,
			output: 3.0,
			cacheWrite: 0.05,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		supportsGlobalEndpoint: true,
		temperature: 1.0,
		reasoning: {
			enabled: true,
			thinkingLevel: "high",
			supportsThinkingLevel: true,
		},
	},
	"claude-sonnet-4-5@20250929": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		reasoning: {
			enabled: true,
		},
	},
	"claude-sonnet-4@20250514": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		reasoning: {
			enabled: true,
		},
	},
	"claude-haiku-4-5@20251001": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
		pricing: {
			input: 1.0,
			output: 5.0,
			cacheWrite: 1.25,
			cacheRead: 0.1,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
		},
	},
	"claude-opus-4-5@20251101": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		reasoning: {
			enabled: true,
		},
	},
	"claude-opus-4-1@20250805": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		reasoning: {
			enabled: true,
		},
	},
	"claude-opus-4@20250514": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		reasoning: {
			enabled: true,
		},
	},
	"claude-3-7-sonnet@20250219": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
		reasoning: {
			enabled: true,
			maxBudgetTokens: 64000,
			outputPrice: 15.0,
		},
	},
	"claude-3-5-sonnet-v2@20241022": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
	"claude-3-5-sonnet@20240620": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
	"claude-3-5-haiku@20241022": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
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
	},
	"claude-3-opus@20240229": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
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
	"claude-3-haiku@20240307": {
		maxOutputTokens: 4096,
		contextWindow: 200_000,
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
	"mistral-large-2411": {
		maxOutputTokens: 128_000,
		contextWindow: 128_000,
		pricing: {
			input: 2.0,
			output: 6.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"mistral-small-2503": {
		maxOutputTokens: 128_000,
		contextWindow: 128_000,
		pricing: {
			input: 0.1,
			output: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"codestral-2501": {
		maxOutputTokens: 256_000,
		contextWindow: 256_000,
		pricing: {
			input: 0.3,
			output: 0.9,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"llama-4-maverick-17b-128e-instruct-maas": {
		maxOutputTokens: 128_000,
		contextWindow: 1_048_576,
		pricing: {
			input: 0.35,
			output: 1.15,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"llama-4-scout-17b-16e-instruct-maas": {
		maxOutputTokens: 1_000_000,
		contextWindow: 10_485_760,
		pricing: {
			input: 0.25,
			output: 0.7,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-2.0-flash-001": {
		maxOutputTokens: 8192,
		contextWindow: 1_048_576,
		pricing: {
			input: 0.15,
			output: 0.6,
			cacheWrite: 1.0,
			cacheRead: 0.025,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		supportsGlobalEndpoint: true,
	},
	"gemini-2.0-flash-lite-001": {
		maxOutputTokens: 8192,
		contextWindow: 1_048_576,
		pricing: {
			input: 0.075,
			output: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		supportsGlobalEndpoint: true,
	},
	"gemini-2.0-flash-thinking-exp-1219": {
		maxOutputTokens: 8192,
		contextWindow: 32_767,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		supportsGlobalEndpoint: true,
	},
	"gemini-2.0-flash-exp": {
		maxOutputTokens: 8192,
		contextWindow: 1_048_576,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		supportsGlobalEndpoint: true,
	},
	"gemini-2.5-pro-exp-03-25": {
		maxOutputTokens: 65536,
		contextWindow: 1_048_576,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-2.5-pro": {
		maxOutputTokens: 65536,
		contextWindow: 1_048_576,
		pricing: {
			input: 2.5,
			output: 15,
			cacheRead: 0.625,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		supportsGlobalEndpoint: true,
		reasoning: {
			maxBudgetTokens: 32767,
		},
		pricingTiers: [
			{
				contextWindow: 200000,
				input: 1.25,
				output: 10,
				cacheRead: 0.31,
			},
			{
				contextWindow: Infinity,
				input: 2.5,
				output: 15,
				cacheRead: 0.625,
			},
		],
	},
	"gemini-2.5-flash": {
		maxOutputTokens: 65536,
		contextWindow: 1_048_576,
		pricing: {
			input: 0.3,
			output: 2.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		supportsGlobalEndpoint: true,
		reasoning: {
			maxBudgetTokens: 24576,
			outputPrice: 3.5,
		},
	},
	"gemini-2.5-flash-lite-preview-06-17": {
		maxOutputTokens: 64000,
		contextWindow: 1_000_000,
		pricing: {
			input: 0.1,
			output: 0.4,
			cacheRead: 0.025,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		supportsGlobalEndpoint: true,
		description: "Preview version - may not be available in all regions",
		reasoning: {
			maxBudgetTokens: 24576,
		},
	},
	"gemini-2.0-flash-thinking-exp-01-21": {
		maxOutputTokens: 65_536,
		contextWindow: 1_048_576,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		supportsGlobalEndpoint: true,
	},
	"gemini-exp-1206": {
		maxOutputTokens: 8192,
		contextWindow: 2_097_152,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-1.5-flash-002": {
		maxOutputTokens: 8192,
		contextWindow: 1_048_576,
		pricing: {
			input: 0.15,
			output: 0.6,
			cacheWrite: 1.0,
			cacheRead: 0.0375,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		pricingTiers: [
			{
				contextWindow: 128000,
				input: 0.075,
				output: 0.3,
				cacheRead: 0.01875,
			},
			{
				contextWindow: Infinity,
				input: 0.15,
				output: 0.6,
				cacheRead: 0.0375,
			},
		],
	},
	"gemini-1.5-flash-exp-0827": {
		maxOutputTokens: 8192,
		contextWindow: 1_048_576,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-1.5-flash-8b-exp-0827": {
		maxOutputTokens: 8192,
		contextWindow: 1_048_576,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-1.5-pro-002": {
		maxOutputTokens: 8192,
		contextWindow: 2_097_152,
		pricing: {
			input: 1.25,
			output: 5,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-1.5-pro-exp-0827": {
		maxOutputTokens: 8192,
		contextWindow: 2_097_152,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
