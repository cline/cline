import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "asksage"

const MODELS: Record<string, ModelInfo> = {
	"gpt-4o": {
		maxOutputTokens: 4096,
		contextWindow: 128_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"gpt-4o-gov": {
		maxOutputTokens: 4096,
		contextWindow: 128_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"gpt-4.1": {
		maxOutputTokens: 32_768,
		contextWindow: 1_047_576,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"claude-35-sonnet": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"aws-bedrock-claude-35-sonnet-gov": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"claude-37-sonnet": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"claude-4-sonnet": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"claude-4-opus": {
		maxOutputTokens: 8192,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"google-gemini-2.5-pro": {
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
	"google-claude-45-sonnet": {
		maxOutputTokens: 64000,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"google-claude-4-opus": {
		maxOutputTokens: 32000,
		contextWindow: 200_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"gpt-5": {
		maxOutputTokens: 65536,
		contextWindow: 2_097_152,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"gpt-5-mini": {
		maxOutputTokens: 32768,
		contextWindow: 1_048_576,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"gpt-5-nano": {
		maxOutputTokens: 16384,
		contextWindow: 262_144,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
