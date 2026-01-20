import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "gemini"

const GEMINI_MODELS: Record<string, ModelInfo> = {
	"gemini-3-pro-preview": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65536,
		pricing: {
			input: 4.0,
			output: 18.0,
			cacheRead: 0.4,
		},
		pricingTiers: [
			{
				contextWindow: 200000,
				input: 2.0,
				output: 12.0,
				cacheRead: 0.2,
			},
			{
				contextWindow: Infinity,
				input: 4.0,
				output: 18.0,
				cacheRead: 0.4,
			},
		],
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			thinkingLevel: "high",
			supportsThinkingLevel: true,
		},
	},
	"gemini-3-flash-preview": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65536,
		pricing: {
			input: 0.5,
			output: 3.0,
			cacheWrite: 0.05,
		},
		pricingTiers: [
			{
				contextWindow: 200000,
				input: 0.3,
				output: 2.5,
				cacheRead: 0.03,
			},
			{
				contextWindow: Infinity,
				input: 0.3,
				output: 2.5,
				cacheRead: 0.03,
			},
		],
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			thinkingLevel: "low",
			supportsThinkingLevel: true,
		},
		supportsGlobalEndpoint: true,
	},
	"gemini-2.5-pro": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65536,
		pricing: {
			input: 2.5,
			output: 15,
			cacheRead: 0.625,
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
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			maxBudgetTokens: 32767,
		},
	},
	"gemini-2.5-flash-lite-preview-06-17": {
		contextWindow: 1_000_000,
		maxOutputTokens: 64000,
		pricing: {
			input: 0.1,
			output: 0.4,
			cacheRead: 0.025,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			maxBudgetTokens: 24576,
		},
		supportsGlobalEndpoint: true,
		description: "Preview version - may not be available in all regions",
	},
	"gemini-2.5-flash": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65536,
		pricing: {
			input: 0.3,
			output: 2.5,
			cacheRead: 0.075,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			maxBudgetTokens: 24576,
			outputPrice: 3.5,
		},
	},
	"gemini-2.0-flash-001": {
		contextWindow: 1_048_576,
		maxOutputTokens: 8192,
		pricing: {
			input: 0.1,
			output: 0.4,
			cacheRead: 0.025,
			cacheWrite: 1.0,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
	},
	"gemini-2.0-flash-lite-preview-02-05": {
		contextWindow: 1_048_576,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-2.0-pro-exp-02-05": {
		contextWindow: 2_097_152,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-2.0-flash-thinking-exp-01-21": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-2.0-flash-thinking-exp-1219": {
		contextWindow: 32_767,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-2.0-flash-exp": {
		contextWindow: 1_048_576,
		maxOutputTokens: 8192,
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
		contextWindow: 1_048_576,
		maxOutputTokens: 8192,
		pricing: {
			input: 0.15,
			output: 0.6,
			cacheRead: 0.0375,
			cacheWrite: 1.0,
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
		capabilities: {
			images: true,
			promptCache: true,
		},
	},
	"gemini-1.5-flash-exp-0827": {
		contextWindow: 1_048_576,
		maxOutputTokens: 8192,
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
		contextWindow: 1_048_576,
		maxOutputTokens: 8192,
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
		contextWindow: 2_097_152,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-1.5-pro-exp-0827": {
		contextWindow: 2_097_152,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gemini-exp-1206": {
		contextWindow: 2_097_152,
		maxOutputTokens: 8192,
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

modelRegistry.registerProvider(PROVIDER_NAME, GEMINI_MODELS)
