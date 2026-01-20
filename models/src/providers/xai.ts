import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "xai"

const MODELS: Record<string, ModelInfo> = {
	"grok-4": {
		maxOutputTokens: 8192,
		contextWindow: 262144,
		pricing: {
			input: 3.0, // will have different pricing for long context vs short context
			output: 15.0,
			cacheRead: 0.75,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
	},
	"grok-4-1-fast-reasoning": {
		contextWindow: 2_000_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 0.2,
			output: 0.5,
			cacheRead: 0.05,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "xAI's Grok 4.1 Reasoning Fast - multimodal model with 2M context.",
	},
	"grok-4-1-fast-non-reasoning": {
		contextWindow: 2_000_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 0.2,
			output: 0.5,
			cacheRead: 0.05,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		description: "xAI's Grok 4.1 Non-Reasoning Fast - multimodal model with 2M context.",
	},
	"grok-code-fast-1": {
		contextWindow: 256_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 0.2,
			output: 1.5,
			cacheRead: 0.02,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "xAI's Grok Coding model.",
	},
	"grok-4-fast-reasoning": {
		maxOutputTokens: 30000,
		contextWindow: 2000000,
		pricing: {
			input: 0.2,
			output: 0.5,
			cacheRead: 0.05,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: "xAI's Grok 4 Fast (free) multimodal model with 2M context.",
	},
	"grok-3-beta": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 3.0,
			output: 15.0,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 beta model with 131K context window",
	},
	"grok-3-fast-beta": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 5.0,
			output: 25.0,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 fast beta model with 131K context window",
	},
	"grok-3-mini-beta": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 0.3,
			output: 0.5,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 mini beta model with 131K context window",
	},
	"grok-3-mini-fast-beta": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 0.6,
			output: 4.0,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 mini fast beta model with 131K context window",
	},
	"grok-3": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 3.0,
			output: 15.0,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 model with 131K context window",
	},
	"grok-3-fast": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 5.0,
			output: 25.0,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 fast model with 131K context window",
	},
	"grok-3-mini": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 0.3,
			output: 0.5,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 mini model with 131K context window",
	},
	"grok-3-mini-fast": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 0.6,
			output: 4.0,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description: "X AI's Grok-3 mini fast model with 131K context window",
	},
	"grok-2-latest": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 2.0,
			output: 10.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "X AI's Grok-2 model - latest version with 131K context window",
	},
	"grok-2": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 2.0,
			output: 10.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "X AI's Grok-2 model with 131K context window",
	},
	"grok-2-1212": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 2.0,
			output: 10.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "X AI's Grok-2 model (version 1212) with 131K context window",
	},
	"grok-2-vision-latest": {
		maxOutputTokens: 8192,
		contextWindow: 32768,
		pricing: {
			input: 2.0,
			output: 10.0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: "X AI's Grok-2 Vision model - latest version with image support and 32K context window",
	},
	"grok-2-vision": {
		maxOutputTokens: 8192,
		contextWindow: 32768,
		pricing: {
			input: 2.0,
			output: 10.0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: "X AI's Grok-2 Vision model with image support and 32K context window",
	},
	"grok-2-vision-1212": {
		maxOutputTokens: 8192,
		contextWindow: 32768,
		pricing: {
			input: 2.0,
			output: 10.0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: "X AI's Grok-2 Vision model (version 1212) with image support and 32K context window",
	},
	"grok-vision-beta": {
		maxOutputTokens: 8192,
		contextWindow: 8192,
		pricing: {
			input: 5.0,
			output: 15.0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: "X AI's Grok Vision Beta model with image support and 8K context window",
	},
	"grok-beta": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 5.0,
			output: 15.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "X AI's Grok Beta model (legacy) with 131K context window",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
