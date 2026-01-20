import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "moonshot"

const MODELS: Record<string, ModelInfo> = {
	"kimi-k2-0905-preview": {
		contextWindow: 262144,
		maxOutputTokens: 16384,
		pricing: {
			input: 0.6,
			output: 2.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		temperature: 0.6,
	},
	"kimi-k2-0711-preview": {
		contextWindow: 131_072,
		maxOutputTokens: 32_000,
		pricing: {
			input: 0.6,
			output: 2.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		temperature: 0.6,
	},
	"kimi-k2-turbo-preview": {
		contextWindow: 262_144,
		maxOutputTokens: 32_000,
		pricing: {
			input: 2.4,
			output: 10,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		temperature: 0.6,
	},
	"kimi-k2-thinking": {
		contextWindow: 262_144,
		maxOutputTokens: 32_000,
		pricing: {
			input: 0.6,
			output: 2.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		temperature: 1.0,
	},
	"kimi-k2-thinking-turbo": {
		contextWindow: 262_144,
		maxOutputTokens: 32_000,
		pricing: {
			input: 2.4,
			output: 10,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		temperature: 1.0,
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
